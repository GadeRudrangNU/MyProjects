// Operator commands referenced by RUNBOOK.md. Run with: pnpm --filter @bytedrop/api ops <command>
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { loadConfig } from "../src/config";
import { blobs, deliveryEvents, objects, outbox, uploadSessions, webhookDeliveries } from "../src/db/schema";
import { collectGarbage } from "../src/jobs/handlers";
import { createRuntime } from "../src/runtime";
import { rollupSince } from "../src/services/analytics";
import { dispatchOutbox } from "../src/services/webhooks";

const [command = "help", ...rest] = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? Number(rest[i + 1]) : fallback;
};

function dirSize(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        files++;
        bytes += statSync(p).size;
      }
    }
  };
  try {
    walk(dir);
  } catch {
    /* directory not created yet */
  }
  return { files, bytes };
}

const cfg = loadConfig({ LOG_LEVEL: "warn" });
const rt = await createRuntime(cfg, { service: "worker", queue: false });
const { ctx } = rt;

try {
  switch (command) {
    case "stats": {
      const count = async (t: PgTable, where?: SQL) => (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(t).where(where))[0]!.n;
      const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
      const blobDisk = dirSize(path.join(cfg.DATA_DIR, "blobs"));
      const cacheDisk = dirSize(path.join(cfg.DATA_DIR, "cache"));
      const tmpDisk = dirSize(path.join(cfg.DATA_DIR, "tmp"));
      const [unref] = await ctx.db
        .select({ n: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(size), 0)::float8` })
        .from(blobs)
        .where(sql`ref_count = 0`);
      console.log(`objects                 ${await count(objects)}`);
      console.log(`blobs on disk           ${blobDisk.files} files, ${mb(blobDisk.bytes)}`);
      console.log(`blobs with no owner     ${unref!.n} (${mb(unref!.bytes)}) waiting for garbage collection`);
      console.log(`transform cache         ${cacheDisk.files} files, ${mb(cacheDisk.bytes)} (limit ${mb(cfg.TRANSFORM_CACHE_BYTES)})`);
      console.log(`upload scratch space    ${tmpDisk.files} files, ${mb(tmpDisk.bytes)}`);
      console.log(`active upload sessions  ${await count(uploadSessions, sql`status = 'active'`)}`);
      console.log(`undelivered outbox rows ${await count(outbox, sql`dispatched_at is null`)}`);
      console.log(`deliveries pending      ${await count(webhookDeliveries, sql`status = 'pending'`)}`);
      console.log(`deliveries failed       ${await count(webhookDeliveries, sql`status = 'failed'`)}`);
      console.log(`raw delivery events     ${await count(deliveryEvents)}`);
      break;
    }
    case "gc": {
      const grace = flag("grace-ms", 5 * 60 * 1000);
      console.log(await collectGarbage(ctx, grace));
      break;
    }
    case "rollup": {
      const hours = flag("hours", 3);
      await ctx.events.flush();
      console.log(`recomputed ${await rollupSince(ctx.pool, new Date(Date.now() - hours * 3_600_000))} hourly groups`);
      break;
    }
    case "relay": {
      let total = 0;
      for (let n = await dispatchOutbox(ctx); n > 0; n = await dispatchOutbox(ctx)) total += n;
      console.log(`dispatched ${total} outbox events`);
      break;
    }
    default:
      console.log("commands: stats | gc [--grace-ms N] | rollup [--hours N] | relay");
  }
} finally {
  await rt.close();
}
process.exit(0);

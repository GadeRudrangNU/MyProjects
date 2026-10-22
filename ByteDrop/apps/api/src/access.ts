import { and, eq, isNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { KeyScope } from "@bytedrop/shared";
import type { Auth } from "./auth";
import type { AppContext } from "./context";
import { apiKeys, projects } from "./db/schema";
import { HttpError, sha256Hex } from "./util";

export type Principal =
  | { kind: "session"; userId: string; id: string }
  | { kind: "key"; projectId: string; scope: KeyScope; keyId: string; id: string }
  | { kind: "anonymous"; id: string };

export type AccessLevel = "read" | "write" | "admin";

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

const lastTouched = new Map<string, number>();

export function extractApiKey(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.toLowerCase().startsWith("bearer ")) {
    const v = header.slice(7).trim();
    if (v.startsWith("bd_")) return v;
  }
  const x = req.headers["x-api-key"];
  if (typeof x === "string" && x.startsWith("bd_")) return x;
  return null;
}

export async function resolvePrincipal(ctx: AppContext, auth: Auth, req: FastifyRequest): Promise<Principal> {
  const secret = extractApiKey(req);
  if (secret) {
    const [key] = await ctx.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, sha256Hex(secret)), isNull(apiKeys.revokedAt)))
      .limit(1);
    if (!key) throw new HttpError(401, "invalid_api_key", "API key is invalid or revoked");
    const now = Date.now();
    if (now - (lastTouched.get(key.id) ?? 0) > 60_000) {
      lastTouched.set(key.id, now);
      void ctx.db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, key.id))
        .catch(() => {});
    }
    return { kind: "key", projectId: key.projectId, scope: key.scope, keyId: key.id, id: `key:${key.id}` };
  }

  if (req.headers.cookie) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
    }
    const session = await auth.api.getSession({ headers });
    if (session) return { kind: "session", userId: session.user.id, id: `user:${session.user.id}` };
  }
  return { kind: "anonymous", id: `ip:${req.ip}` };
}

/** Throws unless the caller may act on the project at the requested level. */
export async function authorize(
  ctx: AppContext,
  req: FastifyRequest,
  projectId: string,
  level: AccessLevel,
): Promise<Principal> {
  const p = req.principal;
  if (!p || p.kind === "anonymous") throw new HttpError(401, "unauthorized", "Authentication required");

  if (p.kind === "key") {
    if (level === "admin") throw new HttpError(403, "forbidden", "This action needs a dashboard session");
    if (p.projectId !== projectId) throw new HttpError(403, "forbidden", "API key belongs to another project");
    if (level === "write" && p.scope !== "write") {
      throw new HttpError(403, "insufficient_scope", "API key is read-only");
    }
    return p;
  }

  const [owned] = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, p.userId)))
    .limit(1);
  if (!owned) throw new HttpError(404, "project_not_found", "Project not found");
  return p;
}

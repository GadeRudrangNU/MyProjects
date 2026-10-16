#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { parseCsv } = require("./csv");

const ROOT = path.join(__dirname, "..");
const DB = path.join(ROOT, "data", "runtime", "sim-db.json");
const IMPORT_CSV = path.join(ROOT, "data", "processed", "import_history.csv");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "atf") {
    const { runSuite } = require("./atf");
    const { failed } = runSuite({ agentUrl: arg("agent", "http://127.0.0.1:9") });
    process.exit(failed ? 1 : 0);
  }
  if (cmd === "serve") {
    const { start } = require("./server");
    const port = Number(arg("port", 8070));
    if (process.argv.includes("--fresh") && fs.existsSync(DB)) fs.unlinkSync(DB);
    const fresh = !fs.existsSync(DB);
    const s = await start({ port, dbFile: DB, quiet: false });
    if (fresh && fs.existsSync(IMPORT_CSV) && !process.argv.includes("--no-import")) {
      const rows = parseCsv(fs.readFileSync(IMPORT_CSV, "utf8"));
      const n = s.inst.importTickets(rows);
      console.log(`imported ${n} historical tickets`);
      s.inst.save(DB);
    }
    const agent = arg("agent");
    if (agent) s.inst.table("sys_properties").forEach((r) => r.name === "x_tp.agent_url" && (r.value = agent));
    console.log(`instance ready on http://127.0.0.1:${port}`);
    const stop = async () => {
      await s.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }
  console.error("usage: cli.js serve [--port N] [--fresh] [--agent URL] | atf");
  process.exit(2);
}

main();

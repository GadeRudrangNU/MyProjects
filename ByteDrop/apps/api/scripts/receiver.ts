import { createHmac } from "node:crypto";
import http from "node:http";

// A small webhook receiver for local development. Run with RECEIVER_SECRET set to verify signatures.
// POST /mode?m=ok|fail|hang flips its behaviour so retries and the replay button can be exercised.
const port = Number(process.env.RECEIVER_PORT ?? 4010);
const secret = process.env.RECEIVER_SECRET;
let mode: "ok" | "fail" | "hang" = (process.env.RECEIVER_MODE as "ok" | "fail" | "hang") ?? "ok";
let received = 0;

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/mode") {
      mode = (url.searchParams.get("m") as typeof mode) ?? "ok";
      return res.writeHead(200).end(`mode=${mode}\n`);
    }
    if (url.pathname === "/stats") return res.writeHead(200).end(JSON.stringify({ mode, received }));
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      received++;
      let verified = "unchecked";
      if (secret) {
        const sig = String(req.headers["bytedrop-signature"] ?? "");
        const t = /t=(\d+)/.exec(sig)?.[1];
        const v1 = /v1=([a-f0-9]+)/.exec(sig)?.[1];
        verified = t && v1 && createHmac("sha256", secret).update(`${t}.${body}`).digest("hex") === v1 ? "valid" : "INVALID";
      }
      console.log(`${new Date().toISOString()} ${req.headers["bytedrop-event"]} signature=${verified} mode=${mode}`);
      if (mode === "hang") return;
      if (mode === "fail") return res.writeHead(500).end("receiver is failing");
      res.writeHead(200).end("ok");
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`webhook receiver on http://127.0.0.1:${port}/hook (mode=${mode})`));

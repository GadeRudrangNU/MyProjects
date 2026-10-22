import http from "node:http";
import type { AddressInfo } from "node:net";

export interface Hit {
  at: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: { id: string; type: string; createdAt: string; data: Record<string, unknown> };
}

export type Behaviour = "ok" | "fail" | "hang";

export async function startReceiver(initial: Behaviour = "ok") {
  const hits: Hit[] = [];
  let behaviour: Behaviour = initial;
  let failFirst = 0;
  const sockets = new Set<import("node:net").Socket>();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      hits.push({ at: Date.now(), headers: req.headers, body, json: JSON.parse(body) });
      if (behaviour === "hang") return; // never answers
      if (behaviour === "fail" || failFirst-- > 0) return res.writeHead(500).end("boom");
      res.writeHead(200).end("ok");
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/hook`,
    hits,
    set: (b: Behaviour) => (behaviour = b),
    failFirst: (n: number) => (failFirst = n),
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

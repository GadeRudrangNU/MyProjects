// Helper process: performs one HTTP request and prints {status, body}. Lets server scripts call out synchronously.
const http = require("node:http");
const https = require("node:https");

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const req = JSON.parse(input);
  const url = new URL(req.url);
  const lib = url.protocol === "https:" ? https : http;
  const r = lib.request(
    url,
    { method: req.method, headers: req.headers, timeout: req.timeout || 10000 },
    (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        process.stdout.write(JSON.stringify({ status: res.statusCode, body }));
      });
    }
  );
  r.on("timeout", () => r.destroy(new Error("timeout")));
  r.on("error", (e) => {
    process.stdout.write(JSON.stringify({ error: e.message || String(e.code) }));
  });
  if (req.body) r.write(req.body);
  r.end();
});

// Tiny stand-in for the agent service used by the instance tests. Records every request it gets.
const http = require("node:http");

const seen = [];
let mode = "ok";

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/__seen") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(seen));
      }
      if (req.url.startsWith("/__mode/")) {
        mode = req.url.split("/")[2];
        res.writeHead(200);
        return res.end("ok");
      }
      seen.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      if (mode === "error") {
        res.writeHead(500);
        return res.end("{}");
      }
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "queued" }));
    });
  })
  .listen(Number(process.argv[2]), "127.0.0.1", () => console.log("ready"));

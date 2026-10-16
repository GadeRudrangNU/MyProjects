const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Instance } = require("./instance");
const { page, esc } = require("./ui");

const STATIC = path.join(__dirname, "static");
const APP = path.join(__dirname, "..", "servicenow");

function start({ port = 8070, dbFile, quiet = true } = {}) {
  const inst = new Instance({ baseUrl: `http://127.0.0.1:${port}`, quiet });
  if (dbFile && fs.existsSync(dbFile)) inst.load(dbFile);
  else inst.seed();
  inst.scheduleDrain = () => setImmediate(() => inst.drain());
  const sessions = new Map();

  const saver = dbFile ? setInterval(() => inst.dirty && inst.save(dbFile), 5000) : null;

  function sessionUser(req) {
    const m = /tp_session=([a-f0-9]+)/.exec(req.headers.cookie || "");
    return m ? sessions.get(m[1]) : null;
  }

  function send(res, status, body, type = "text/html; charset=utf-8", extra = {}) {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, inst.baseUrl);
    const p = url.pathname;
    try {
      if (p === "/healthz") return send(res, 200, JSON.stringify({ ok: true }), "application/json");

      if (p === "/login") {
        if (req.method === "POST") {
          const form = new URLSearchParams(await readBody(req));
          const u = inst._find("sys_user", (r) => r.user_name === form.get("user_name") && r.password === form.get("password"));
          if (!u) return send(res, 401, page(null, "Sign in", `<p class="error">Wrong user name or password.</p>${loginForm()}`));
          const token = crypto.randomBytes(16).toString("hex");
          sessions.set(token, inst._userObj(u));
          return send(res, 302, "", "text/plain", { Location: form.get("next") || "/incident_list.do", "Set-Cookie": `tp_session=${token}; Path=/; HttpOnly` });
        }
        return send(res, 200, page(null, "Sign in", loginForm()));
      }

      if (p.startsWith("/static/")) {
        const f = path.join(STATIC, path.basename(p));
        if (fs.existsSync(f)) return send(res, 200, fs.readFileSync(f), p.endsWith(".css") ? "text/css" : "text/javascript");
        return send(res, 404, "not found");
      }
      if (p.startsWith("/app/")) {
        const f = path.join(APP, p.slice(5));
        if (f.startsWith(APP) && fs.existsSync(f)) return send(res, 200, fs.readFileSync(f), "text/javascript");
        return send(res, 404, "not found");
      }

      if (p.startsWith("/api/")) {
        const body = await readBody(req);
        const headers = { ...req.headers };
        if (!headers.authorization) {
          const su = sessionUser(req);
          if (su) {
            const rec = inst._find("sys_user", (r) => r.user_name === su.user_name);
            headers.authorization = "Basic " + Buffer.from(`${rec.user_name}:${rec.password}`).toString("base64");
          }
        }
        const r = inst.handleHttp(req.method, p, url.searchParams, headers, body);
        const extra = r.total !== undefined ? { "X-Total-Count": String(r.total) } : {};
        return send(res, r.status, JSON.stringify(r.body), "application/json", extra);
      }

      const user = sessionUser(req);
      if (!user) return send(res, 302, "", "text/plain", { Location: "/login?next=" + encodeURIComponent(req.url) });

      if (p === "/sim/ajax" && req.method === "POST") {
        const { name, params } = JSON.parse(await readBody(req));
        inst.user = user;
        try {
          return send(res, 200, JSON.stringify({ answer: inst.ajax(name, params) }), "application/json");
        } finally {
          inst.user = inst.system;
          if (inst.queue.length) inst.scheduleDrain();
        }
      }
      if (p === "/sim/state") {
        const id = url.searchParams.get("sys_id");
        const inc = inst.table("incident").get(id);
        const runs = [...inst.table("x_tp_ai_triage_run").values()].filter((r) => r.incident === id);
        const last = runs.sort((a, b) => b._seq - a._seq)[0];
        return send(res, 200, JSON.stringify({ ai: inc && inc.u_ai_suggestion_state, run: last && last.status, outcome: last && last.outcome, runs: runs.length }), "application/json");
      }
      if (p === "/sim/log") return send(res, 200, JSON.stringify(inst.log), "application/json");

      const view = require("./views");
      const html = view.render(inst, user, p, url.searchParams);
      if (html === null) return send(res, 404, page(user, "Not found", "<p>No such page.</p>"));
      if (html.redirect) return send(res, 302, "", "text/plain", { Location: html.redirect });
      return send(res, 200, html);
    } catch (e) {
      console.error(e);
      return send(res, 500, `<pre>${esc(e.stack)}</pre>`);
    }
  });

  function loginForm() {
    return `<form method="post" action="/login" class="card narrow"><label>User name<input name="user_name" autofocus></label>
      <label>Password<input name="password" type="password"></label><button class="primary">Sign in</button></form>`;
  }

  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      resolve({
        inst,
        server,
        port,
        close() {
          if (saver) clearInterval(saver);
          if (dbFile) inst.save(dbFile);
          return new Promise((r) => server.close(r));
        },
      });
    })
  );
}

module.exports = { start };

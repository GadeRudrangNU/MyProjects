const test = require("node:test");
const assert = require("node:assert/strict");
const { start } = require("../server");

let srv, base, cookie;

test.before(async () => {
  srv = await start({ port: 18071 });
  base = `http://127.0.0.1:${srv.port}`;
});
test.after(() => srv.close());

async function login(user, password) {
  const r = await fetch(`${base}/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ user_name: user, password }) });
  return r;
}

test("pages need a session and the login form checks the password", async () => {
  const anon = await fetch(`${base}/incident_list.do`, { redirect: "manual" });
  assert.equal(anon.status, 302);
  assert.equal((await login("desk.agent", "wrong")).status, 401);
  const ok = await login("desk.agent", "agent-local");
  assert.equal(ok.status, 302);
  cookie = ok.headers.get("set-cookie").split(";")[0];
});

test("incident list, form, approvals, runs, knowledge and dashboard pages render", async () => {
  const get = (p) => fetch(`${base}${p}`, { headers: { cookie } });
  const gr = srv.inst.glideRecord("incident");
  gr.initialize();
  gr.setValue("short_description", "Monitor has no signal");
  gr.setValue("u_imported", "true");
  const id = gr.insert();
  for (const p of ["/incident_list.do?all=1", "/incident_new.do", `/incident.do?sys_id=${id}`, "/approvals.do", "/runs.do", "/kb.do", "/kb.do?number=KB0010001", "/dashboard.do"]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /TriagePilot/);
  }
  assert.equal((await get("/nope.do")).status, 404);
  const form = await (await get(`/incident.do?sys_id=${id}`)).text();
  assert.match(form, /Monitor has no signal/);
  assert.match(form, /client_scripts\/incident_ai_banner\.js/);
  assert.doesNotMatch(form, /Accept suggestion/);
});

test("the form shows Accept and Reject only while a suggestion is pending", async () => {
  const gr = srv.inst.glideRecord("incident");
  gr.initialize();
  gr.setValue("short_description", "Pending one");
  gr.setValue("u_imported", "true");
  gr.setValue("u_ai_suggestion_state", "pending");
  const id = gr.insert();
  const html = await (await fetch(`${base}/incident.do?sys_id=${id}`, { headers: { cookie } })).text();
  assert.match(html, /Accept suggestion/);
  assert.match(html, /Reject suggestion/);
});

test("GlideAjax goes through the session user", async () => {
  const gr = srv.inst.glideRecord("incident");
  gr.initialize();
  gr.setValue("short_description", "Ajax one");
  gr.setValue("u_imported", "true");
  const id = gr.insert();
  const r = await fetch(`${base}/sim/ajax`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ name: "x_tp.TriageAjax", params: { sysparm_name: "reject", sysparm_incident: id, sysparm_reason: "" } }) });
  assert.equal(JSON.parse((await r.json()).answer).ok, false);
});

test("the Table API accepts the session cookie and basic auth", async () => {
  const withCookie = await fetch(`${base}/api/x_tp/triage/metrics`, { headers: { cookie } });
  assert.equal(withCookie.status, 200);
  const basic = await fetch(`${base}/api/now/table/kb_knowledge?sysparm_limit=2&sysparm_fields=number`, { headers: { Authorization: "Basic " + Buffer.from("svc_triagepilot:triage-local").toString("base64") } });
  assert.equal(basic.status, 200);
  assert.equal((await basic.json()).result.length, 2);
  assert.equal((await fetch(`${base}/api/now/table/incident`)).status, 401);
});

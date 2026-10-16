const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const vm = require("node:vm");
const { Instance } = require("../instance");
const { runSuite } = require("../atf");

const ROOT = path.join(__dirname, "..", "..");
const AGENT_PORT = 18123;
let stub;

test.before(async () => {
  stub = cp.spawn(process.execPath, [path.join(__dirname, "stub_agent.js"), String(AGENT_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((r) => stub.stdout.once("data", r));
});
test.after(() => stub.kill());

const seen = async () => (await fetch(`http://127.0.0.1:${AGENT_PORT}/__seen`)).json();
const mode = (m) => fetch(`http://127.0.0.1:${AGENT_PORT}/__mode/${m}`);

function fresh() {
  const inst = new Instance();
  inst.seed();
  inst.table("sys_properties").forEach((r) => {
    if (r.name === "x_tp.agent_url") r.value = `http://127.0.0.1:${AGENT_PORT}`;
  });
  return inst;
}

function newIncident(inst, fields = {}) {
  const gr = inst.glideRecord("incident");
  gr.initialize();
  gr.setValue("short_description", fields.short_description || "Laptop will not start");
  gr.setValue("description", fields.description || "Black screen, call 617-555-0142 or mail me@example.com");
  gr.setValue("priority", fields.priority || "3");
  for (const [k, v] of Object.entries(fields)) gr.setValue(k, v);
  const id = gr.insert();
  inst.drain();
  return id;
}

const runsFor = (inst, id) => [...inst.table("x_tp_ai_triage_run").values()].filter((r) => r.incident === id);
const group = (inst, name) => [...inst.table("sys_user_group").values()].find((g) => g.name === name).sys_id;

function finishRun(inst, id, over = {}) {
  const run = runsFor(inst, id)[0];
  const body = {
    run_sys_id: run.sys_id, incident_sys_id: id, status: "completed", category: "Hardware", assignment_group: "TP Hardware Support",
    confidence: 0.9, path: "fast", reasoning: "Classifier is 90% sure.", reply_draft: "Please try the charger only.",
    cited_articles: ["KB0010011"], similar_incidents: ["T00012"], latency_ms: 800, attempts: 1, trace: [{ step: "classify", ms: 3 }], ...over,
  };
  const auth = "Basic " + Buffer.from("svc_triagepilot:triage-local").toString("base64");
  const r = inst.handleHttp("POST", "/api/x_tp/triage/result", new URLSearchParams(), { Authorization: auth }, JSON.stringify(body));
  inst.drain();
  return r;
}

test("the ATF suite passes", () => {
  const { failed, results } = runSuite({ log: () => {} });
  assert.equal(failed, 0, JSON.stringify(results.filter((r) => r.assertions.some((a) => !a.ok))));
});

test("PII scrubbing in the Script Include matches the shared cases", () => {
  const inst = fresh();
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "shared", "pii_cases.json"), "utf8"));
  for (const c of cases) {
    inst.ctx.__in = c.in;
    assert.equal(vm.runInContext("new TriagePII().scrub(__in)", inst.ctx), c.out, c.in);
  }
});

test("a new incident sends a scrubbed payload with the token to the agent", async () => {
  const inst = fresh();
  const id = newIncident(inst);
  const run = runsFor(inst, id)[0];
  assert.equal(run.status, "queued");
  assert.equal(run.run_key, `${id}:0`);
  const req = (await seen()).find((r) => r.body && r.body.incident_sys_id === id);
  assert.equal(req.url, "/v1/triage");
  assert.equal(req.auth, "Bearer local-dev-token");
  assert.ok(!JSON.stringify(req.body).includes("617-555") && !JSON.stringify(req.body).includes("me@example.com"));
  assert.match(req.body.description, /\[PHONE\].*\[EMAIL\]/);
  assert.equal(req.body.run_sys_id, run.sys_id);
});

test("imported history does not trigger triage", () => {
  const inst = fresh();
  const id = newIncident(inst, { u_imported: "true" });
  assert.equal(runsFor(inst, id).length, 0);
});

test("an unreachable or failing agent marks the run failed and leaves a work note", async () => {
  await mode("error");
  const inst = fresh();
  const id = newIncident(inst);
  await mode("ok");
  const run = runsFor(inst, id)[0];
  assert.equal(run.status, "failed");
  assert.match(run.error_message, /HTTP 500/);
  assert.equal(run.outcome, "failed");
  const notes = [...inst.table("sys_journal_field").values()].filter((n) => n.element_id === id);
  assert.ok(notes.some((n) => n.value.includes("AI triage failed")));

  const dead = fresh();
  dead.table("sys_properties").forEach((r) => r.name === "x_tp.agent_url" && (r.value = "http://127.0.0.1:9"));
  const id2 = newIncident(dead);
  assert.match(runsFor(dead, id2)[0].error_message, /unreachable/);
});

test("high confidence routes automatically with reasoning and article links", () => {
  const inst = fresh();
  const id = newIncident(inst);
  assert.equal(finishRun(inst, id).status, 200);
  const inc = inst.table("incident").get(id);
  assert.equal(inc.category, "Hardware");
  assert.equal(inc.assignment_group, group(inst, "TP Hardware Support"));
  assert.equal(inc.u_ai_suggestion_state, "applied_auto");
  assert.equal(runsFor(inst, id)[0].outcome, "auto_routed");
  const note = [...inst.table("sys_journal_field").values()].find((n) => n.element_id === id).value;
  assert.match(note, /Why: Classifier is 90% sure/);
  assert.match(note, /KB0010011/);
  assert.equal([...inst.table("sysapproval_approver").values()].length, 0);
});

test("priority 1 and 2 always go to a person even when the agent is sure", () => {
  for (const p of ["1", "2"]) {
    const inst = fresh();
    const id = newIncident(inst, { priority: p });
    finishRun(inst, id, { confidence: 0.99 });
    const inc = inst.table("incident").get(id);
    assert.equal(inc.category || "", "");
    assert.equal(inc.u_ai_suggestion_state, "pending");
    assert.equal([...inst.table("sysapproval_approver").values()].length, 1);
  }
});

test("the threshold comes from a system property", () => {
  const inst = fresh();
  inst.table("sys_properties").forEach((r) => r.name === "x_tp.auto_route_threshold" && (r.value = "0.95"));
  const id = newIncident(inst);
  finishRun(inst, id, { confidence: 0.9 });
  assert.equal(inst.table("incident").get(id).u_ai_suggestion_state, "pending");
});

test("needs_review always creates an approval", () => {
  const inst = fresh();
  const id = newIncident(inst);
  finishRun(inst, id, { status: "needs_review", confidence: 0.99, errors: ["citation KB9 was not retrieved"] });
  assert.equal([...inst.table("sysapproval_approver").values()].length, 1);
  assert.equal(runsFor(inst, id)[0].outcome, "approval_requested");
});

test("accept applies the suggestion, closes the approval and logs feedback", () => {
  const inst = fresh();
  const id = newIncident(inst);
  finishRun(inst, id, { confidence: 0.5, path: "llm" });
  const agent = inst.userByName("desk.agent");
  inst.user = agent;
  const out = JSON.parse(inst.ajax("x_tp.TriageAjax", { sysparm_name: "accept", sysparm_incident: id }));
  inst.user = inst.system;
  assert.equal(out.ok, true);
  const inc = inst.table("incident").get(id);
  assert.equal(inc.category, "Hardware");
  assert.equal(inc.u_ai_suggestion_state, "accepted");
  assert.equal([...inst.table("sysapproval_approver").values()][0].state, "approved");
  const fb = [...inst.table("x_tp_ai_feedback").values()];
  assert.equal(fb.length, 1);
  assert.equal(fb[0].decision, "accepted");
  const again = JSON.parse(inst.ajax("x_tp.TriageAjax", { sysparm_name: "accept", sysparm_incident: id }));
  assert.equal(again.ok, false);
});

test("reject needs a reason and keeps the category empty", () => {
  const inst = fresh();
  const id = newIncident(inst);
  finishRun(inst, id, { confidence: 0.5, path: "llm" });
  const blank = JSON.parse(inst.ajax("x_tp.TriageAjax", { sysparm_name: "reject", sysparm_incident: id, sysparm_reason: "  " }));
  assert.equal(blank.ok, false);
  const ok = JSON.parse(inst.ajax("x_tp.TriageAjax", { sysparm_name: "reject", sysparm_incident: id, sysparm_reason: "This is a storage problem" }));
  assert.equal(ok.ok, true);
  assert.equal(inst.table("incident").get(id).category || "", "");
  assert.equal(inst.table("incident").get(id).u_ai_suggestion_state, "rejected");
  const fb = [...inst.table("x_tp_ai_feedback").values()][0];
  assert.deepEqual([fb.decision, fb.reason], ["rejected", "This is a storage problem"]);
});

test("approving in the approval list applies the suggestion once", () => {
  const inst = fresh();
  const id = newIncident(inst);
  finishRun(inst, id, { confidence: 0.5, path: "llm" });
  const ap = [...inst.table("sysapproval_approver").values()][0];
  const auth = "Basic " + Buffer.from("desk.agent:agent-local").toString("base64");
  const r = inst.handleHttp("PATCH", `/api/now/table/sysapproval_approver/${ap.sys_id}`, new URLSearchParams(), { Authorization: auth }, JSON.stringify({ state: "approved" }));
  assert.equal(r.status, 200);
  assert.equal(inst.table("incident").get(id).u_ai_suggestion_state, "accepted");
  assert.equal([...inst.table("x_tp_ai_feedback").values()].length, 1);
});

test("re-run queues a new run under a new key and records the request", async () => {
  const inst = fresh();
  const id = newIncident(inst);
  finishRun(inst, id, { confidence: 0.5, path: "llm" });
  const out = JSON.parse(inst.ajax("x_tp.TriageAjax", { sysparm_name: "rerun", sysparm_incident: id }));
  assert.equal(out.ok, true);
  const runs = runsFor(inst, id);
  assert.equal(runs.length, 2);
  assert.notEqual(runs[0].run_key, runs[1].run_key);
  assert.ok([...inst.table("x_tp_ai_feedback").values()].some((f) => f.decision === "rerun"));
});

test("resolving captures the final category and asks for a knowledge article", async () => {
  const inst = fresh();
  const id = newIncident(inst);
  const auth = "Basic " + Buffer.from("desk.agent:agent-local").toString("base64");
  const patch = (b) => inst.handleHttp("PATCH", `/api/now/table/incident/${id}`, new URLSearchParams(), { Authorization: auth }, JSON.stringify(b));
  patch({ category: "Storage", state: "2" });
  inst.drain();
  assert.equal(inst.table("incident").get(id).u_final_category || "", "");
  patch({ state: "6", close_notes: "Moved the archive to the network drive." });
  inst.drain();
  assert.equal(inst.table("incident").get(id).u_final_category, "Storage");
  const req = (await seen()).filter((r) => r.url === "/v1/knowledge/draft").pop();
  assert.equal(req.body.incident_sys_id, id);
  assert.match(req.body.close_notes, /network drive/);
  assert.ok(!JSON.stringify(req.body).includes("617-555"));
});

test("an empty close note does not ask for an article", async () => {
  const inst = fresh();
  const id = newIncident(inst);
  const before = (await seen()).filter((r) => r.url === "/v1/knowledge/draft").length;
  const gr = inst.glideRecord("incident");
  gr.get(id);
  gr.setValue("state", "6");
  gr.update();
  inst.drain();
  assert.equal((await seen()).filter((r) => r.url === "/v1/knowledge/draft").length, before);
});

test("the callback is validated and is idempotent", () => {
  const inst = fresh();
  const id = newIncident(inst);
  assert.equal(finishRun(inst, id, { confidence: 1.5 }).status, 400);
  assert.equal(finishRun(inst, id, { category: "Printers" }).status, 400);
  assert.equal(finishRun(inst, id, { assignment_group: "Nope" }).status, 400);
  assert.equal(finishRun(inst, id, { run_sys_id: undefined }).status, 400);
  assert.equal(finishRun(inst, id).status, 200);
  const second = finishRun(inst, id, { category: "Storage" });
  assert.equal(second.body.result.ignored, true);
  assert.equal(runsFor(inst, id)[0].suggested_category, "Hardware");
});

test("ACLs: roles decide who can read or write what", () => {
  const inst = fresh();
  const call = (user, pw, method, p, body) =>
    inst.handleHttp(method, p, new URLSearchParams(), { Authorization: "Basic " + Buffer.from(`${user}:${pw}`).toString("base64") }, body && JSON.stringify(body));
  assert.equal(call("emp.beth", "emp-local", "GET", "/api/now/table/incident").status, 403);
  assert.equal(call("emp.beth", "emp-local", "POST", "/api/now/table/incident", { short_description: "help" }).status, 201);
  assert.equal(call("emp.beth", "emp-local", "GET", "/api/x_tp/triage/metrics").status, 403);
  assert.equal(call("desk.agent", "agent-local", "GET", "/api/x_tp/triage/metrics").status, 200);
  assert.equal(call("desk.agent", "agent-local", "POST", "/api/now/table/x_tp_ai_triage_run", {}).status, 403);
  assert.equal(call("svc_triagepilot", "triage-local", "POST", "/api/now/table/kb_knowledge", { short_description: "x", workflow_state: "draft" }).status, 201);
  assert.equal(call("svc_triagepilot", "triage-local", "GET", "/api/now/table/sys_user").status, 403);
  assert.equal(call("nobody", "x", "GET", "/api/now/table/incident").status, 401);
});

test("the knowledge result endpoint stores what the agent did", () => {
  const inst = fresh();
  const id = newIncident(inst);
  const auth = "Basic " + Buffer.from("svc_triagepilot:triage-local").toString("base64");
  const r = inst.handleHttp("POST", "/api/x_tp/triage/knowledge_result", new URLSearchParams(), { Authorization: auth }, JSON.stringify({ incident_sys_id: id, status: "skipped_duplicate", nearest: "KB0010021", similarity: 0.93 }));
  assert.equal(r.status, 200);
  const rec = [...inst.table("x_tp_knowledge_draft").values()][0];
  assert.equal(rec.status, "skipped_duplicate");
});

test("history import maps categories to groups and skips unknown ones", () => {
  const inst = fresh();
  const n = inst.importTickets([
    { ticket_id: "T00123", document: "reset password locked account please help urgent", topic_group: "Access" },
    { ticket_id: "T00124", document: "need more space shared drive", topic_group: "Storage" },
    { ticket_id: "T00125", document: "something odd", topic_group: "Weather" },
  ]);
  assert.equal(n, 2);
  const incs = [...inst.table("incident").values()];
  const a = incs.find((i) => i.u_corpus_ref === "T00123");
  assert.equal(a.number, "INC0000123");
  assert.equal(a.category, "Access");
  assert.equal(a.assignment_group, group(inst, "TP Access Management"));
  assert.equal(a.state, "6");
  assert.equal(a.u_imported, "true");
  assert.equal(a.u_final_category, "Access");
  assert.equal(a.short_description, "reset password locked account please help urgent");
  assert.equal(inst.table("x_tp_ai_triage_run").size, 0);
  assert.equal(inst.table("x_tp_ticket_import").size, 3);
});

test("metrics count outcomes, accuracy and the fast and LLM paths", () => {
  const inst = fresh();
  const mk = (fields, final) => {
    const id = newIncident(inst, { priority: "3" });
    const run = runsFor(inst, id)[0];
    const auth = "Basic " + Buffer.from("svc_triagepilot:triage-local").toString("base64");
    inst.handleHttp("POST", "/api/x_tp/triage/result", new URLSearchParams(), { Authorization: auth }, JSON.stringify({ run_sys_id: run.sys_id, incident_sys_id: id, status: "completed", category: "Hardware", assignment_group: "TP Hardware Support", confidence: 0.9, path: "fast", latency_ms: 1000, ...fields }));
    inst.drain();
    inst.table("incident").get(id).u_final_category = final;
  };
  mk({}, "Hardware");
  mk({}, "Storage");
  mk({ confidence: 0.4, path: "llm", latency_ms: 5000 }, "Hardware");
  const m = JSON.parse(vm.runInContext("JSON.stringify(new TriageMetrics().summary())", inst.ctx));
  assert.equal(m.answered, 3);
  assert.equal(m.auto_routed, 2);
  assert.equal(m.auto_routed_pct, 66.7);
  assert.equal(m.routing_accuracy_pct, 50);
  assert.equal(m.fast_path_pct, 66.7);
  assert.equal(m.p95_latency_ms, 5000);
  const hw = m.accuracy_by_category.find((c) => c.category === "Hardware");
  assert.equal(hw.total, 3);
});

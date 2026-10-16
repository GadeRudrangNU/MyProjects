// Runs the app's ATF-style tests (servicenow/atf) against a fresh in-memory instance.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Instance } = require("./instance");

const APP = path.join(__dirname, "..", "servicenow");

function runSuite({ agentUrl = "http://127.0.0.1:9", log = console.log } = {}) {
  const inst = new Instance({ baseUrl: "http://127.0.0.1:8070" });
  inst.seed();
  inst.table("sys_properties").forEach((r) => {
    if (r.name === "x_tp.agent_url") r.value = agentUrl;
  });
  const suite = JSON.parse(fs.readFileSync(path.join(APP, "atf", "atf.json"), "utf8"));
  const results = [];
  for (const test of suite.tests) {
    const outcome = { name: test.name, assertions: [], error: null };
    const outputs = {};
    const stepResult = { setOutputMessage() {} };
    const assertEqual = ({ name, shouldbe, value }) => {
      outcome.assertions.push({ name, ok: shouldbe === value, shouldbe, value });
    };
    try {
      for (const file of test.steps) {
        const code = fs.readFileSync(path.join(APP, file), "utf8");
        Object.assign(inst.ctx, { outputs, steps: () => ({}), params: {}, stepResult, assertEqual });
        vm.runInContext(code, inst.ctx, { filename: file });
      }
    } catch (e) {
      outcome.error = e.message;
    }
    results.push(outcome);
  }
  let failed = 0;
  for (const r of results) {
    const bad = r.assertions.filter((a) => !a.ok).length + (r.error ? 1 : 0) + (r.assertions.length === 0 ? 1 : 0);
    failed += bad ? 1 : 0;
    log(`${bad ? "FAIL" : "PASS"}  ${r.name}  (${r.assertions.length} checks)`);
    for (const a of r.assertions) if (!a.ok) log(`        - ${a.name}: expected ${JSON.stringify(a.shouldbe)}, got ${JSON.stringify(a.value)}`);
    if (r.error) log(`        - script error: ${r.error}`);
  }
  log(`\n${results.length - failed}/${results.length} tests passed`);
  return { results, failed, inst };
}

module.exports = { runSuite };

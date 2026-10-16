(async function () {
  const r = await fetch("/api/x_tp/triage/metrics");
  const root = document.getElementById("dash");
  if (!r.ok) {
    root.innerHTML = '<p class="error">You need the itil role to see this dashboard.</p>';
    return;
  }
  const m = (await r.json()).result;
  const pct = (v) => (v === null || v === undefined ? "n/a" : v + "%");
  const tile = (label, value, note) => `<div class="tile"><div class="v">${value}</div><div class="l">${label}</div>${note ? `<div class="n">${note}</div>` : ""}</div>`;
  const fast = m.fast_path_pct || 0;
  const llm = m.llm_path_pct || 0;
  root.innerHTML = `
    <div class="tiles">
      ${tile("Routed automatically", pct(m.auto_routed_pct), `${m.auto_routed} of ${m.answered} answered runs`)}
      ${tile("Routing accuracy", pct(m.routing_accuracy_pct), "auto-routed, checked against the resolved category")}
      ${tile("Suggestions accepted", pct(m.acceptance_rate_pct), `${m.accepted} accepted, ${m.rejected} rejected`)}
      ${tile("p95 latency", m.p95_latency_ms === null ? "n/a" : (m.p95_latency_ms / 1000).toFixed(1) + " s", "agent run, end to end")}
      ${tile("Failed runs", m.failed_runs, `of ${m.total_runs} runs`)}
      ${tile("Articles drafted", m.articles_drafted, `${m.articles_skipped} skipped as duplicates`)}
    </div>
    <div class="panel"><h2>Fast path and LLM path</h2>
      <div class="stack"><div class="seg a" style="width:${fast}%">${fast ? "fast " + fast + "%" : ""}</div><div class="seg b" style="width:${llm}%">${llm ? "LLM " + llm + "%" : ""}</div></div></div>
    <div class="panel"><h2>Accuracy by category</h2>
      ${m.accuracy_by_category.map((c) => `<div class="barrow"><span>${c.category}</span><div class="track"><div class="fill" style="width:${c.accuracy || 0}%"></div></div><b>${pct(c.accuracy)}</b><small>${c.total} resolved</small></div>`).join("") || '<p class="muted">Waiting for resolved incidents.</p>'}
    </div>`;
})();

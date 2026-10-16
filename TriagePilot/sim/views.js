const fs = require("node:fs");
const path = require("node:path");
const { page, esc } = require("./ui");

const STATES = { 1: "New", 2: "In progress", 6: "Resolved", 7: "Closed" };
const AI_LABEL = { none: "", pending: "Waiting for a decision", applied_auto: "Routed automatically", accepted: "Accepted", rejected: "Rejected", applied: "Applied" };

function badge(text, kind = "") {
  return text ? `<span class="badge ${kind}">${esc(text)}</span>` : "";
}

function aiBadge(v) {
  const kind = { pending: "warn", applied_auto: "ok", accepted: "ok", rejected: "bad" }[v] || "";
  return badge(AI_LABEL[v] ?? v, kind);
}

function groupName(inst, id) {
  const g = inst.table("sys_user_group").get(id);
  return g ? g.name : "";
}

function incidentList(inst, user, params) {
  const all = params.get("all") === "1";
  const pg = Math.max(1, Number(params.get("page") || 1));
  const q = (params.get("q") || "").toLowerCase();
  let rows = [...inst.table("incident").values()].filter((r) => (all ? true : r.u_imported !== "true"));
  if (q) rows = rows.filter((r) => (r.number + " " + r.short_description).toLowerCase().includes(q));
  rows.sort((a, b) => b._seq - a._seq);
  const total = rows.length;
  rows = rows.slice((pg - 1) * 50, pg * 50);
  const body = `<form class="bar" method="get"><input name="q" value="${esc(params.get("q") || "")}" placeholder="Search number or text">
    <label class="inline"><input type="checkbox" name="all" value="1" ${all ? "checked" : ""}> include imported history</label><button>Filter</button>
    <a class="btn primary" href="/incident_new.do">New incident</a></form>
    <p class="muted">${total} incidents</p>
    <table><thead><tr><th>Number</th><th>Short description</th><th>Category</th><th>Assignment group</th><th>Priority</th><th>State</th><th>AI triage</th></tr></thead><tbody>
    ${rows
      .map(
        (r) => `<tr><td><a href="/incident.do?sys_id=${r.sys_id}">${esc(r.number)}</a></td><td>${esc(r.short_description)}</td><td>${esc(r.category)}</td>
      <td>${esc(groupName(inst, r.assignment_group))}</td><td>${esc(r.priority)}</td><td>${esc(STATES[r.state] || r.state)}</td><td>${aiBadge(r.u_ai_suggestion_state)}</td></tr>`
      )
      .join("")}</tbody></table>
    <p class="pager">${pg > 1 ? `<a href="?page=${pg - 1}${all ? "&all=1" : ""}">Previous</a>` : ""} ${pg * 50 < total ? `<a href="?page=${pg + 1}${all ? "&all=1" : ""}">Next</a>` : ""}</p>`;
  return page(user, "Incidents", body, { active: "/incident_list.do" });
}

function incidentNew(inst, user) {
  const body = `<form id="newform" class="card"><label>Short description<input name="short_description" required></label>
    <label>Description<textarea name="description" rows="5"></textarea></label>
    <label>Priority<select name="priority"><option value="4">4 - Low</option><option value="3">3 - Moderate</option><option value="2">2 - High</option><option value="1">1 - Critical</option></select></label>
    <button class="primary" id="create">Submit</button><span id="msg" class="muted"></span></form>
    <script>
    document.getElementById('newform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const r = await fetch('/api/now/table/incident', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(f)});
      const j = await r.json();
      if (r.ok) location.href = '/incident.do?sys_id=' + j.result.sys_id; else document.getElementById('msg').textContent = j.error.message;
    });
    </script>`;
  return page(user, "New incident", body, { active: "/incident_new.do" });
}

function actionVisible(a, rec) {
  const c = a.condition;
  if (!c) return true;
  const v = String(rec[c.field] ?? "");
  return c.op === "=" ? v === c.value || (c.value === "false" && v === "") : v !== c.value;
}

function incidentForm(inst, user, params) {
  const id = params.get("sys_id");
  const rec = inst.table("incident").get(id);
  if (!rec) return null;
  const cats = inst.manifest.categories;
  const groups = [...inst.table("sys_user_group").values()];
  const notes = [...inst.table("sys_journal_field").values()].filter((n) => n.element_id === id).sort((a, b) => b._seq - a._seq);
  const runs = [...inst.table("x_tp_ai_triage_run").values()].filter((r) => r.incident === id).sort((a, b) => b._seq - a._seq);
  const approvals = [...inst.table("sysapproval_approver").values()].filter((r) => r.document_id === id);
  const actions = inst.manifest.ui_actions.filter((a) => actionVisible(a, rec));
  const canEdit = inst.allowed(user, "incident", "write");
  const opts = (list, cur) => list.map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("");
  const body = `
  <div id="messages"></div>
  <div class="toolbar">
    ${canEdit ? `<button class="primary" id="btn-save">Save</button><button id="btn-resolve">Resolve</button>` : ""}
    ${canEdit ? actions.map((a) => `<button class="action" data-onclick="${esc(a.onclick)}">${esc(a.name.replace(" AI suggestion", " suggestion"))}</button>`).join("") : ""}
  </div>
  <form id="form" class="grid" onsubmit="return false">
    <div class="row" data-field="number"><label>Number</label><input name="number" value="${esc(rec.number)}" disabled></div>
    <div class="row" data-field="priority"><label>Priority</label><input name="priority" value="${esc(rec.priority)}" disabled></div>
    <div class="row wide" data-field="short_description"><label>Short description</label><input name="short_description" value="${esc(rec.short_description)}" ${canEdit ? "" : "disabled"}></div>
    <div class="row wide" data-field="description"><label>Description</label><textarea name="description" rows="5" disabled>${esc(rec.description)}</textarea></div>
    <div class="row" data-field="category"><label>Category</label><select name="category" ${canEdit ? "" : "disabled"}><option value=""></option>${opts(cats, rec.category)}</select></div>
    <div class="row" data-field="assignment_group"><label>Assignment group</label><select name="assignment_group" ${canEdit ? "" : "disabled"}><option value=""></option>${groups
      .map((g) => `<option value="${g.sys_id}" ${g.sys_id === rec.assignment_group ? "selected" : ""}>${esc(g.name)}</option>`)
      .join("")}</select></div>
    <div class="row" data-field="state"><label>State</label><select name="state" ${canEdit ? "" : "disabled"}>${Object.entries(STATES)
      .map(([k, v]) => `<option value="${k}" ${k === rec.state ? "selected" : ""}>${v}</option>`)
      .join("")}</select></div>
    <div class="row" data-field="u_ai_suggestion_state"><label>AI suggestion</label><input name="u_ai_suggestion_state" value="${esc(rec.u_ai_suggestion_state)}" disabled></div>
    <div class="row wide" data-field="u_reject_reason"><label>Reason for rejecting the AI suggestion</label><input name="u_reject_reason" value=""></div>
    <div class="row wide" data-field="close_notes"><label>Close notes</label><textarea name="close_notes" rows="2" ${canEdit ? "" : "disabled"}>${esc(rec.close_notes)}</textarea></div>
    <div class="row wide" data-field="work_notes"><label>Work notes</label><textarea name="work_notes" rows="2" ${canEdit ? "" : "disabled"}></textarea></div>
  </form>

  <h2>AI triage runs</h2>
  ${
    runs.length
      ? `<table><thead><tr><th>Status</th><th>Outcome</th><th>Suggested</th><th>Confidence</th><th>Path</th><th>Latency</th></tr></thead><tbody>${runs
          .map(
            (r) => `<tr><td>${badge(r.status, r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : "warn")}</td><td>${esc(r.outcome)}</td>
        <td>${esc(r.suggested_category)}<br><small class="muted">${esc(groupName(inst, r.suggested_group))}</small></td>
        <td>${r.confidence && Number(r.confidence) ? Math.round(Number(r.confidence) * 100) + "%" : ""}</td><td>${esc(r.path)}</td><td>${r.latency_ms && r.latency_ms !== "0" ? esc(r.latency_ms) + " ms" : ""}</td></tr>
        ${r.reply_draft ? `<tr class="sub"><td colspan="6"><b>Draft reply</b> ${esc(r.reply_draft)}<br><small class="muted">${esc(r.reasoning)}${r.cited_articles ? " Articles: " + esc(r.cited_articles) : ""}</small></td></tr>` : ""}
        ${r.error_message ? `<tr class="sub"><td colspan="6" class="error">${esc(r.error_message)}</td></tr>` : ""}`
          )
          .join("")}</tbody></table>`
      : `<p class="muted">No AI triage run for this incident.</p>`
  }
  ${approvals.length ? `<h2>Approvals</h2><table><tbody>${approvals.map((a) => `<tr><td>${badge(a.state, a.state === "requested" ? "warn" : a.state === "approved" ? "ok" : "bad")}</td><td>${esc(groupName(inst, a.group))}</td><td>${esc(a.comments)}</td></tr>`).join("")}</tbody></table>` : ""}

  <h2>Activity</h2>
  <ul class="notes">${notes.map((n) => `<li><b>${esc(n.sys_created_by)}</b> <span class="muted">${esc(n.sys_created_on)}</span><pre>${esc(n.value).replace(/\[code\]|\[\/code\]/g, "")}</pre></li>`).join("") || '<li class="muted">No activity yet.</li>'}</ul>
  <script>window.FORM = ${JSON.stringify({ sys_id: id, table: "incident", ai: rec.u_ai_suggestion_state, run: runs[0] ? runs[0].status : undefined, outcome: runs[0] ? runs[0].outcome : undefined })};</script>
  <script src="/static/client.js"></script>
  <script src="/app/client_scripts/incident_ai_banner.js"></script>
  ${actions.map((a) => `<script src="/app/${a.script}"></script>`).join("\n")}
  <script>boot();</script>`;
  return page(user, `${rec.number}`, body, { active: "/incident_list.do" });
}

function approvals(inst, user) {
  const rows = [...inst.table("sysapproval_approver").values()].sort((a, b) => b._seq - a._seq);
  const body = `<table><thead><tr><th>Incident</th><th>Group</th><th>State</th><th>Why</th><th></th></tr></thead><tbody>${rows
    .map((a) => {
      const inc = inst.table("incident").get(a.document_id);
      return `<tr><td>${inc ? `<a href="/incident.do?sys_id=${inc.sys_id}">${esc(inc.number)}</a> ${esc(inc.short_description)}` : esc(a.document_id)}</td><td>${esc(groupName(inst, a.group))}</td>
      <td>${badge(a.state, a.state === "requested" ? "warn" : a.state === "approved" ? "ok" : "bad")}</td><td>${esc(a.comments)}</td>
      <td>${a.state === "requested" ? `<button class="primary" data-approve="${a.sys_id}">Approve</button> <button data-reject="${a.sys_id}">Reject</button>` : ""}</td></tr>`;
    })
    .join("")}</tbody></table>
  ${rows.length ? "" : '<p class="muted">Nothing is waiting for approval.</p>'}
  <script>
  document.querySelectorAll('[data-approve],[data-reject]').forEach(b => b.addEventListener('click', async () => {
    const approve = b.dataset.approve; const id = approve || b.dataset.reject;
    const body = approve ? {state:'approved'} : {state:'rejected', comments:'Rejected from the approval list'};
    await fetch('/api/now/table/sysapproval_approver/' + id, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
    location.reload();
  }));
  </script>`;
  return page(user, "Approvals", body, { active: "/approvals.do" });
}

function runs(inst, user) {
  const rows = [...inst.table("x_tp_ai_triage_run").values()].sort((a, b) => b._seq - a._seq).slice(0, 100);
  const body = `<table><thead><tr><th>Incident</th><th>Status</th><th>Outcome</th><th>Category</th><th>Conf.</th><th>Path</th><th>Latency</th><th>Steps</th></tr></thead><tbody>${rows
    .map((r) => {
      const inc = inst.table("incident").get(r.incident);
      let trace = [];
      try {
        trace = JSON.parse(r.trace || "[]");
      } catch {}
      return `<tr><td>${inc ? `<a href="/incident.do?sys_id=${inc.sys_id}">${esc(inc.number)}</a>` : ""}</td><td>${badge(r.status, r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : "warn")}</td>
      <td>${esc(r.outcome)}</td><td>${esc(r.suggested_category)}</td><td>${Number(r.confidence) ? Math.round(Number(r.confidence) * 100) + "%" : ""}</td><td>${esc(r.path)}</td><td>${Number(r.latency_ms) ? esc(r.latency_ms) + " ms" : ""}</td>
      <td>${trace.map((s) => `<span class="step">${esc(s.step)} <small>${s.ms}ms</small></span>`).join("")}</td></tr>`;
    })
    .join("")}</tbody></table>`;
  return page(user, "AI triage runs", body, { active: "/runs.do" });
}

function kb(inst, user, params) {
  const num = params.get("number");
  if (num) {
    const a = [...inst.table("kb_knowledge").values()].find((r) => r.number === num);
    if (!a) return null;
    return page(user, `${a.number} - ${a.short_description}`, `<p>${badge(a.workflow_state, a.workflow_state === "published" ? "ok" : "warn")} <span class="muted">${esc(a.u_category)}</span></p><div class="card">${a.text}</div>${a.u_source_incident ? `<p class="muted">Drafted from incident <a href="/incident.do?sys_id=${a.u_source_incident}">${esc((inst.table("incident").get(a.u_source_incident) || {}).number)}</a></p>` : ""}<p><a href="/kb.do">Back to the list</a></p>`, { active: "/kb.do" });
  }
  const rows = [...inst.table("kb_knowledge").values()].sort((a, b) => (a.workflow_state === b.workflow_state ? b._seq - a._seq : a.workflow_state === "draft" ? -1 : 1));
  const drafts = [...inst.table("x_tp_knowledge_draft").values()].sort((a, b) => b._seq - a._seq).slice(0, 8);
  const body = `<table><thead><tr><th>Number</th><th>Title</th><th>Category</th><th>State</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td><a href="/kb.do?number=${r.number}">${esc(r.number)}</a></td><td>${esc(r.short_description)}</td><td>${esc(r.u_category)}</td><td>${badge(r.workflow_state, r.workflow_state === "published" ? "ok" : "warn")}</td></tr>`)
    .join("")}</tbody></table>
  <h2>Knowledge agent log</h2>
  ${drafts.length ? `<table><thead><tr><th>Incident</th><th>Result</th><th>Article</th><th>Closest existing</th><th>Similarity</th></tr></thead><tbody>${drafts
    .map((d) => `<tr><td>${esc((inst.table("incident").get(d.incident) || {}).number)}</td><td>${badge(d.status, d.status === "drafted" ? "ok" : d.status === "failed" ? "bad" : "warn")}</td><td>${esc(d.article_number)}</td><td>${esc(d.nearest_article)}</td><td>${Number(d.similarity) ? Number(d.similarity).toFixed(2) : ""}</td></tr>`)
    .join("")}</tbody></table>` : '<p class="muted">Nothing yet. Articles are drafted when an incident is resolved.</p>'}`;
  return page(user, "Knowledge", body, { active: "/kb.do" });
}

function dashboard(inst, user) {
  const body = `<div id="dash" class="dash"><p class="muted">Loading</p></div>
  <script src="/static/dashboard.js"></script>`;
  return page(user, "AI triage dashboard", body, { active: "/dashboard.do" });
}

function render(inst, user, p, params) {
  switch (p) {
    case "/":
      return { redirect: "/incident_list.do" };
    case "/incident_list.do":
      return incidentList(inst, user, params);
    case "/incident_new.do":
      return incidentNew(inst, user);
    case "/incident.do":
      return incidentForm(inst, user, params);
    case "/approvals.do":
      return approvals(inst, user);
    case "/runs.do":
      return runs(inst, user);
    case "/kb.do":
      return kb(inst, user, params);
    case "/dashboard.do":
      return dashboard(inst, user);
    default:
      return null;
  }
}

module.exports = { render };

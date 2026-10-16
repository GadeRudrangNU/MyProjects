const NAV = [
  ["Incidents", "/incident_list.do"],
  ["New incident", "/incident_new.do"],
  ["Approvals", "/approvals.do"],
  ["AI triage runs", "/runs.do"],
  ["Knowledge", "/kb.do"],
  ["Dashboard", "/dashboard.do"],
];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function page(user, title, body, { active = "", head = "" } = {}) {
  const nav = user
    ? `<nav>${NAV.map(([n, h]) => `<a href="${h}" class="${active === h ? "on" : ""}">${n}</a>`).join("")}<span class="who">${esc(user.name)}</span></nav>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} - TriagePilot instance</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/style.css">${head}</head>
<body><header><div class="brand">TriagePilot <small>local instance</small></div>${nav}</header><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

module.exports = { page, esc, NAV };

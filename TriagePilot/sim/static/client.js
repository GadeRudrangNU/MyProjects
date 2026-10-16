// Browser runtime for the incident form: g_form, GlideAjax and the form buttons.
const g_user = {};

const g_form = {
  _el: (n) => document.querySelector(`[name="${n}"]`),
  getValue: (n) => (g_form._el(n) ? g_form._el(n).value : ""),
  setValue: (n, v) => { if (g_form._el(n)) g_form._el(n).value = v; },
  getUniqueValue: () => window.FORM.sys_id,
  getFormElement: () => document.getElementById("form"),
  setVisible(n, visible) {
    const row = document.querySelector(`[data-field="${n}"]`);
    if (row) row.style.display = visible ? "" : "none";
  },
  _msg(text, kind) {
    const box = document.getElementById("messages");
    const d = document.createElement("div");
    d.className = "msg " + kind;
    d.textContent = text;
    box.appendChild(d);
  },
  addInfoMessage(t) { g_form._msg(t, "info"); },
  addErrorMessage(t) { g_form._msg(t, "error"); },
  showFieldMsg(n, text, kind) {
    const row = document.querySelector(`[data-field="${n}"]`);
    if (!row) return;
    row.querySelectorAll(".fieldmsg").forEach((e) => e.remove());
    const d = document.createElement("div");
    d.className = "fieldmsg " + (kind || "info");
    d.textContent = text;
    row.appendChild(d);
  },
};

function GlideAjax(name) {
  this.name = name;
  this.params = {};
}
GlideAjax.prototype.addParam = function (k, v) {
  this.params[k] = v;
};
GlideAjax.prototype.getXMLAnswer = function (cb) {
  fetch("/sim/ajax", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: this.name, params: this.params }) })
    .then((r) => r.json())
    .then((j) => cb(j.answer));
};

function gsftSubmit() {
  location.reload();
}

async function patch(fields) {
  const r = await fetch("/api/now/table/incident/" + window.FORM.sys_id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
  if (!r.ok) {
    const j = await r.json();
    g_form.addErrorMessage(j.error.message);
    return false;
  }
  return true;
}

function boot() {
  const save = document.getElementById("btn-save");
  if (save) {
    save.onclick = async () => {
      const fields = {};
      for (const n of ["short_description", "category", "assignment_group", "state", "close_notes", "work_notes"]) {
        const v = g_form.getValue(n);
        if (v !== "") fields[n] = v;
      }
      if (await patch(fields)) location.reload();
    };
    document.getElementById("btn-resolve").onclick = async () => {
      const notes = g_form.getValue("close_notes").trim();
      if (!notes) {
        g_form.showFieldMsg("close_notes", "Close notes are required to resolve.", "error");
        return;
      }
      const fields = { state: "6", close_notes: notes };
      const cat = g_form.getValue("category");
      if (cat) fields.category = cat;
      if (await patch(fields)) location.reload();
    };
  }
  document.querySelectorAll("[data-onclick]").forEach((b) => {
    b.onclick = () => window[b.dataset.onclick.replace("()", "")]();
  });
  if (typeof onLoad === "function") onLoad();

  // pick up the agent's answer without a manual refresh
  const first = window.FORM;
  let ticks = 0;
  const timer = setInterval(async () => {
    ticks++;
    const s = await (await fetch("/sim/state?sys_id=" + first.sys_id)).json();
    if (s.ai !== first.ai || s.run !== first.run || s.outcome !== first.outcome) location.reload();
    if (ticks > 120) clearInterval(timer);
  }, 1500);
}

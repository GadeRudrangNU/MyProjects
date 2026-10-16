// A local stand-in for a ServiceNow instance. It loads the app source from ../servicenow and runs the real
// scripts against an in-memory database, with GlideRecord, gs, RESTMessageV2, business rules, flows and ACLs.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const { parseEncoded, matches, sortRows } = require("./query");

const APP = path.join(__dirname, "..", "servicenow");

const BOOTSTRAP = `
var Class = { create: function () { return function () { this.initialize.apply(this, arguments); }; } };
Object.extendsObject = function (parent, props) {
  var obj = Object.create(parent.prototype);
  for (var k in props) { obj[k] = props[k]; }
  return obj;
};
var AbstractAjaxProcessor = Class.create();
AbstractAjaxProcessor.prototype = {
  initialize: function (request) { this.request = request || {}; },
  getParameter: function (name) { return this.request[name]; },
  type: 'AbstractAjaxProcessor'
};
`;

const BUILTIN_REFS = {
  "incident.assignment_group": "sys_user_group",
  "incident.caller_id": "sys_user",
  "sysapproval_approver.group": "sys_user_group",
};
const DISPLAY = {
  sys_user_group: "name",
  sys_user: "name",
  incident: "number",
  kb_knowledge: "number",
  x_tp_ai_triage_run: "run_key",
  sysapproval_approver: "sys_id",
};

function nowStamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

class Instance {
  constructor({ baseUrl = "http://127.0.0.1:8070", quiet = true } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "") + "/";
    this.quiet = quiet;
    this.tables = {};
    this.counters = {};
    this.seq = 0;
    this.queue = [];
    this.draining = false;
    this.scheduleDrain = null;
    this.noRules = false;
    this.dirty = false;
    this.log = [];
    this.manifest = JSON.parse(fs.readFileSync(path.join(APP, "manifest.json"), "utf8"));
    this.system = { sys_id: "system", user_name: "system", name: "System", roles: ["*system*"] };
    this.user = this.system;
    this._loadApp();
  }

  // ---------- app loading ----------
  _read(rel) {
    return fs.readFileSync(path.join(APP, rel), "utf8");
  }

  _loadApp() {
    const m = this.manifest;
    this.fieldTypes = { incident: { ...m.incident_fields } };
    for (const [t, def] of Object.entries(m.tables)) this.fieldTypes[t] = { ...def.fields };
    this.rules = m.business_rules.map((r) => ({ ...r, code: this._read(r.script) }));
    this.flows = m.flows.map((f) => JSON.parse(this._read(f)));
    this.flows.forEach((f) => f.steps.forEach((s) => (s.code = s.script)));
    this.restResources = m.rest_resources.map((r) => ({ ...r, code: this._read(r.script) }));
    this.acls = m.acls;
    this._buildContext();
  }

  _buildContext() {
    const self = this;
    const sandbox = {
      console,
      JSON,
      GlideRecord: function (table) {
        return self.glideRecord(table);
      },
      GlideAggregate: function (table) {
        return self.glideAggregate(table);
      },
      gs: this._gs(),
      sn_ws: {
        RESTMessageV2: function () {
          return self._restMessage();
        },
      },
    };
    this.ctx = vm.createContext(sandbox);
    vm.runInContext(BOOTSTRAP, this.ctx);
    for (const name of this.manifest.script_includes) {
      vm.runInContext(this._read(`script_includes/${name}.js`), this.ctx, { filename: `${name}.js` });
    }
  }

  _gs() {
    const self = this;
    return {
      getProperty: (name, def) => {
        const rec = self._find("sys_properties", (r) => r.name === name);
        return rec ? rec.value : def === undefined ? null : def;
      },
      info: (m) => self._syslog("info", m),
      warn: (m) => self._syslog("warn", m),
      error: (m) => self._syslog("error", m),
      debug: () => {},
      log: (m) => self._syslog("info", m),
      getUserID: () => self.user.sys_id,
      getUserName: () => self.user.user_name,
      getUserDisplayName: () => self.user.name,
      hasRole: (r) => self.user.roles.includes("*system*") || self.user.roles.includes(r),
      nowDateTime: () => nowStamp(),
      sleep: () => self.drain(),
    };
  }

  _syslog(level, message) {
    this.log.push({ level, message: String(message), at: nowStamp() });
    if (this.log.length > 500) this.log.shift();
    if (!this.quiet || level === "error") console.log(`[sn ${level}] ${message}`);
  }

  // ---------- storage ----------
  table(name) {
    return (this.tables[name] ||= new Map());
  }

  newId() {
    return crypto.randomBytes(16).toString("hex");
  }

  _find(table, fn) {
    for (const r of this.table(table).values()) if (fn(r)) return r;
    return null;
  }

  refTable(table, field) {
    const t = (this.fieldTypes[table] || {})[field];
    if (t && t.startsWith("reference:")) return t.slice(10);
    return BUILTIN_REFS[`${table}.${field}`] || null;
  }

  display(table, field, value) {
    const ref = this.refTable(table, field);
    if (!ref || !value) return value || "";
    const rec = this.table(ref).get(value);
    return rec ? rec[DISPLAY[ref] || "sys_id"] ?? value : value;
  }

  nextNumber(prefix, start, pad = 7) {
    this.counters[prefix] = (this.counters[prefix] ?? start - 1) + 1;
    return prefix + String(this.counters[prefix]).padStart(pad, "0");
  }

  newRecord(table) {
    const rec = { sys_id: this.newId() };
    for (const [f, t] of Object.entries(this.fieldTypes[table] || {})) {
      if (t === "boolean") rec[f] = "false";
      else if (t === "integer" || t === "decimal") rec[f] = "0";
    }
    if (table === "incident") Object.assign(rec, { state: "1", priority: "4", active: "true", u_ai_suggestion_state: "none" });
    return rec;
  }

  // ---------- GlideRecord ----------
  glideRecord(table) {
    const inst = this;
    const st = { conds: [], order: [], limit: null, rows: [], idx: -1, rec: null, prev: null, isNew: true, op: null, pendingNotes: [] };
    inst.table(table);

    const api = {
      initialize() {
        st.rec = inst.newRecord(table);
        st.prev = null;
        st.isNew = true;
      },
      addQuery(f, a, b) {
        if (b === undefined) st.conds.push([{ field: f, op: "eq", value: String(a) }]);
        else {
          const map = { "=": "eq", "!=": "ne", ">": "gt", "<": "lt", ">=": "gte", "<=": "lte", LIKE: "like", STARTSWITH: "startswith", IN: "in" };
          st.conds.push([{ field: f, op: map[a] || "eq", value: String(b) }]);
        }
      },
      addEncodedQuery(q) {
        const p = parseEncoded(q);
        st.conds.push(...p.clauses);
        st.order.push(...p.order);
      },
      addActiveQuery() {
        st.conds.push([{ field: "active", op: "eq", value: "true" }]);
      },
      orderBy(f) {
        st.order.push({ field: f, desc: false });
      },
      orderByDesc(f) {
        st.order.push({ field: f, desc: true });
      },
      setLimit(n) {
        st.limit = n;
      },
      query() {
        let rows = [...inst.table(table).values()].filter((r) => matches(r, st.conds));
        rows = sortRows(rows, st.order);
        if (st.limit) rows = rows.slice(0, st.limit);
        st.rows = rows;
        st.idx = -1;
      },
      next() {
        st.idx++;
        if (st.idx < st.rows.length) {
          st.rec = st.rows[st.idx];
          st.prev = { ...st.rec };
          st.isNew = false;
          return true;
        }
        return false;
      },
      hasNext: () => st.idx + 1 < st.rows.length,
      getRowCount: () => st.rows.length,
      get(a, b) {
        let rec = null;
        if (b === undefined) rec = inst.table(table).get(String(a)) || null;
        else rec = [...inst.table(table).values()].find((r) => String(r[a]) === String(b)) || null;
        if (!rec) return false;
        st.rec = rec;
        st.prev = { ...rec };
        st.isNew = false;
        return true;
      },
      getValue(f) {
        const v = st.rec ? st.rec[f] : undefined;
        return v === undefined || v === "" || v === null ? null : String(v);
      },
      setValue(f, v) {
        if (!st.rec) api.initialize();
        if (f === "work_notes" || f === "comments") {
          if (v) st.pendingNotes.push({ element: f, value: String(v) });
          return;
        }
        st.rec[f] = v === null || v === undefined ? "" : String(v);
      },
      getUniqueValue: () => (st.rec ? st.rec.sys_id : null),
      getDisplayValue: (f) => (st.rec ? inst.display(table, f, st.rec[f]) : ""),
      getTableName: () => table,
      getElement: (f) => ({ toString: () => st.rec[f] ?? "" }),
      isValidRecord: () => !!st.rec && !st.isNew,
      isNewRecord: () => st.isNew,
      operation: () => st.op,
      canRead: () => true,
      canWrite: () => true,
      changes: () => !!st.prev && JSON.stringify(st.prev) !== JSON.stringify(st.rec),
      insert() {
        return inst._insert(table, st, api);
      },
      update() {
        return inst._update(table, st, api);
      },
      deleteRecord() {
        if (st.rec) inst.table(table).delete(st.rec.sys_id);
        inst.dirty = true;
        return true;
      },
      _state: st,
    };
    return new Proxy(api, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === "symbol") return undefined;
        if (prop === "toJSON") return undefined;
        const v = st.rec ? st.rec[prop] : undefined;
        return v === undefined || v === null ? "" : v;
      },
      set(target, prop, value) {
        api.setValue(prop, value);
        return true;
      },
    });
  }

  glideAggregate(table) {
    const gr = this.glideRecord(table);
    const st = gr._state;
    let count = 0;
    let done = false;
    return {
      addQuery: gr.addQuery,
      addEncodedQuery: gr.addEncodedQuery,
      addAggregate() {},
      query() {
        gr.query();
        count = st.rows.length;
        done = false;
      },
      next() {
        if (done) return false;
        done = true;
        return true;
      },
      getAggregate: () => String(count),
    };
  }

  _insert(table, st, api) {
    const rec = st.rec;
    if (!rec) throw new Error("insert without initialize");
    st.op = "insert";
    if (!rec.sys_id) rec.sys_id = this.newId();
    if (table === "incident" && !rec.number) rec.number = this.nextNumber("INC", 1000001);
    if (table === "kb_knowledge" && !rec.number) rec.number = this.nextNumber("KB", 20001);
    if (table === "sysapproval_approver" && !rec.u_handled_by_feedback) rec.u_handled_by_feedback = "false";
    rec.sys_created_on = nowStamp();
    rec.sys_updated_on = rec.sys_created_on;
    rec.sys_mod_count = "0";
    rec.sys_created_by = this.user.user_name;
    rec._seq = ++this.seq;
    const proxy = new Proxy(api, { get: (t, p) => (p in t ? t[p] : st.rec[p] ?? ""), set: (t, p, v) => (api.setValue(p, v), true) });
    this._runRules(table, "before", "insert", proxy, null, st);
    this.table(table).set(rec.sys_id, rec);
    this.dirty = true;
    this._flushNotes(table, st);
    this._runRules(table, "after", "insert", proxy, null, st);
    this._enqueueAsync(table, "insert", rec, null);
    st.isNew = false;
    st.prev = { ...rec };
    return rec.sys_id;
  }

  _update(table, st, api) {
    const rec = st.rec;
    if (!rec || !rec.sys_id) throw new Error("update without record");
    st.op = "update";
    const prev = st.prev || {};
    const proxy = new Proxy(api, { get: (t, p) => (p in t ? t[p] : st.rec[p] ?? ""), set: (t, p, v) => (api.setValue(p, v), true) });
    const prevProxy = this._readonly(prev);
    this._runRules(table, "before", "update", proxy, prevProxy, st);
    const changed = Object.keys(rec).some((k) => k !== "sys_updated_on" && String(rec[k]) !== String(prev[k] ?? "")) || st.pendingNotes.length > 0;
    if (!changed) return rec.sys_id;
    rec.sys_mod_count = String((Number(rec.sys_mod_count) || 0) + 1);
    rec.sys_updated_on = nowStamp();
    this.dirty = true;
    this._flushNotes(table, st);
    this._runRules(table, "after", "update", proxy, prevProxy, st);
    this._enqueueAsync(table, "update", rec, prev);
    st.prev = { ...rec };
    return rec.sys_id;
  }

  _readonly(snapshot) {
    return new Proxy({ getValue: (f) => snapshot[f] || null }, { get: (t, p) => (p in t ? t[p] : snapshot[p] ?? "") });
  }

  _flushNotes(table, st) {
    for (const n of st.pendingNotes.splice(0)) {
      const id = this.newId();
      this.table("sys_journal_field").set(id, {
        sys_id: id,
        element_id: st.rec.sys_id,
        name: table,
        element: n.element,
        value: n.value,
        sys_created_on: nowStamp(),
        sys_created_by: this.user.user_name,
        _seq: ++this.seq,
      });
    }
  }

  // ---------- business rules & flows ----------
  _condOk(cond, rec, prev, op) {
    if (!cond) return true;
    return cond.all.every((c) => {
      const cur = String(rec[c.field] ?? "");
      const old = prev ? String(prev[c.field] ?? "") : "";
      switch (c.op) {
        case "=": return cur === c.value || (c.value === "false" && cur === "");
        case "!=": return cur !== c.value;
        case "changesTo": return cur === c.value && (op === "insert" || cur !== old);
        case "changes": return op === "insert" ? cur !== "" : cur !== old;
        case "isNotEmpty": return cur !== "";
        case "isEmpty": return cur === "";
        default: return false;
      }
    });
  }

  _runRules(table, when, op, current, previous, st) {
    if (this.noRules) return;
    for (const r of this.rules) {
      if (r.table !== table || r.when !== when || !r.operations.includes(op)) continue;
      if (!this._condOk(r.condition, st.rec, st.prev, op)) continue;
      this._exec(r.code, { current, previous }, r.name);
    }
  }

  _enqueueAsync(table, op, rec, prev) {
    if (this.noRules) return;
    for (const r of this.rules) {
      if (r.table !== table || r.when !== "async" || !r.operations.includes(op)) continue;
      if (!this._condOk(r.condition, rec, prev, op)) continue;
      this.queue.push({ type: "rule", rule: r, table, id: rec.sys_id });
    }
    if (op === "update") {
      for (const f of this.flows) {
        const t = f.trigger;
        if (t.table !== table) continue;
        const c = t.condition;
        if (String(prev[c.field] ?? "") !== String(rec[c.field] ?? "") && c.values.includes(rec[c.field])) {
          this.queue.push({ type: "flow", flow: f, table, id: rec.sys_id });
        }
      }
    }
    if (this.queue.length && this.scheduleDrain) this.scheduleDrain();
  }

  drain() {
    if (this.draining) return;
    this.draining = true;
    const actor = this.user;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        this.user = this.system;
        const gr = this.glideRecord(job.table);
        if (!gr.get(job.id)) continue;
        try {
          if (job.type === "rule") this._exec(job.rule.code, { current: gr, previous: null }, job.rule.name);
          else for (const s of job.flow.steps) this._exec(s.code, { run: gr }, job.flow.name);
        } catch (e) {
          this._syslog("error", `${job.type} failed: ${e.message}`);
        }
      }
    } finally {
      this.user = actor;
      this.draining = false;
    }
  }

  _exec(code, globals, label) {
    Object.assign(this.ctx, globals);
    try {
      return vm.runInContext(code, this.ctx, { filename: label });
    } catch (e) {
      this._syslog("error", `${label}: ${e.message}`);
      throw e;
    }
  }

  // ---------- outbound REST ----------
  _restMessage() {
    const self = this;
    const req = { headers: {}, method: "GET", endpoint: "", body: "", timeout: 10000 };
    return {
      setEndpoint: (u) => (req.endpoint = u),
      setHttpMethod: (m) => (req.method = m),
      setRequestHeader: (k, v) => (req.headers[k] = v),
      setRequestBody: (b) => (req.body = b),
      setHttpTimeout: (t) => (req.timeout = t),
      setBasicAuth: (u, p) => (req.headers.Authorization = "Basic " + Buffer.from(`${u}:${p}`).toString("base64")),
      execute() {
        let out;
        if (req.endpoint.startsWith(self.baseUrl)) {
          const url = new URL(req.endpoint);
          const r = self.handleHttp(req.method, url.pathname, url.searchParams, req.headers, req.body);
          out = { status: r.status, body: typeof r.body === "string" ? r.body : JSON.stringify(r.body) };
        } else {
          const run = cp.spawnSync(process.execPath, [path.join(__dirname, "http_sync.js")], {
            input: JSON.stringify({ url: req.endpoint, method: req.method, headers: req.headers, body: req.body, timeout: req.timeout }),
            encoding: "utf8",
            timeout: req.timeout + 3000,
          });
          out = run.stdout ? JSON.parse(run.stdout) : { error: run.error ? run.error.message : "no output" };
          if (out.error) throw new Error(out.error);
        }
        return { getStatusCode: () => out.status, getBody: () => out.body, getErrorMessage: () => "" };
      },
    };
  }

  // ---------- auth & ACL ----------
  authenticate(headers) {
    const h = headers.authorization || headers.Authorization;
    if (h && h.startsWith("Basic ")) {
      const [u, ...rest] = Buffer.from(h.slice(6), "base64").toString().split(":");
      const rec = this._find("sys_user", (r) => r.user_name === u);
      if (rec && rec.password === rest.join(":")) return this._userObj(rec);
      return null;
    }
    return null;
  }

  userByName(name) {
    const rec = this._find("sys_user", (r) => r.user_name === name);
    return rec ? this._userObj(rec) : null;
  }

  _userObj(rec) {
    return { sys_id: rec.sys_id, user_name: rec.user_name, name: rec.name, roles: rec.roles ? rec.roles.split(",") : [] };
  }

  allowed(user, table, op) {
    if (user.roles.includes("*system*")) return true;
    const rules = this.acls.filter((a) => a.table === table && a.operation === op);
    if (!rules.length) return user.roles.includes("x_tp_admin");
    return rules.some((a) => a.roles.includes("*") || a.roles.some((r) => user.roles.includes(r)));
  }

  // ---------- HTTP (Table API and scoped REST) ----------
  handleHttp(method, pathname, params, headers, rawBody) {
    const lower = {};
    for (const [k, v] of Object.entries(headers || {})) lower[k.toLowerCase()] = v;
    const user = this.authenticate(lower);
    if (!user) return { status: 401, body: { error: { message: "User Not Authenticated" } } };
    const prevUser = this.user;
    this.user = user;
    try {
      const out = this._route(method, pathname, params, rawBody, user);
      if (this.queue.length && this.scheduleDrain) this.scheduleDrain();
      return out;
    } finally {
      this.user = prevUser;
    }
  }

  _route(method, pathname, params, rawBody, user) {
    const forbidden = { status: 403, body: { error: { message: "Insufficient rights to perform this operation" } } };
    const tm = /^\/api\/now\/table\/([a-z0-9_]+)(?:\/([0-9a-f]{32}))?$/.exec(pathname);
    if (tm) {
      const [, table, id] = tm;
      let body = {};
      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          return { status: 400, body: { error: { message: "invalid JSON" } } };
        }
      }
      if (method === "GET") {
        if (!this.allowed(user, table, "read")) return forbidden;
        if (id) {
          const rec = this.table(table).get(id);
          return rec ? { status: 200, body: { result: this._publicRec(rec, params) } } : { status: 404, body: { error: { message: "No Record found" } } };
        }
        const p = parseEncoded(params.get("sysparm_query") || "");
        let rows = sortRows([...this.table(table).values()].filter((r) => matches(r, p.clauses)), p.order);
        const off = Number(params.get("sysparm_offset") || 0);
        const lim = Number(params.get("sysparm_limit") || 100);
        const total = rows.length;
        rows = rows.slice(off, off + lim).map((r) => this._publicRec(r, params));
        return { status: 200, body: { result: rows }, total };
      }
      if (method === "POST") {
        if (!this.allowed(user, table, "create")) return forbidden;
        const gr = this.glideRecord(table);
        gr.initialize();
        for (const [k, v] of Object.entries(body)) gr.setValue(k, v);
        const newId = gr.insert();
        return { status: 201, body: { result: this._publicRec(this.table(table).get(newId), params) } };
      }
      if ((method === "PATCH" || method === "PUT") && id) {
        if (!this.allowed(user, table, "write")) return forbidden;
        const gr = this.glideRecord(table);
        if (!gr.get(id)) return { status: 404, body: { error: { message: "No Record found" } } };
        for (const [k, v] of Object.entries(body)) gr.setValue(k, v);
        gr.update();
        return { status: 200, body: { result: this._publicRec(this.table(table).get(id), params) } };
      }
      return { status: 405, body: { error: { message: "method not allowed" } } };
    }
    const res = this.restResources.find((r) => r.method === method && r.path === pathname);
    if (res) {
      if (!res.roles.some((r) => user.roles.includes(r))) return forbidden;
      let data = null;
      if (rawBody) {
        try {
          data = JSON.parse(rawBody);
        } catch {
          return { status: 400, body: { error: { message: "invalid JSON" } } };
        }
      }
      const response = { status: 200, body: null, setStatus(c) { this.status = c; }, setBody(b) { this.body = b; } };
      const request = { body: { data }, queryParams: Object.fromEntries(params.entries()) };
      try {
        this._exec(res.code, { request, response }, res.path);
      } catch (e) {
        return { status: 500, body: { error: { message: e.message } } };
      }
      return { status: response.status, body: response.body };
    }
    return { status: 404, body: { error: { message: "Requested URI does not represent any resource" } } };
  }

  _publicRec(rec, params) {
    const fields = params && params.get && params.get("sysparm_fields");
    const out = {};
    for (const [k, v] of Object.entries(rec)) if (!k.startsWith("_") && k !== "password") out[k] = v;
    if (!fields) return out;
    const pick = {};
    for (const f of fields.split(",")) pick[f] = out[f] ?? "";
    pick.sys_id = rec.sys_id;
    return pick;
  }

  // ---------- GlideAjax ----------
  ajax(name, params) {
    const cls = name.split(".").pop();
    this.ctx.__ajaxParams = params;
    return vm.runInContext(`new ${cls}(__ajaxParams).${params.sysparm_name}()`, this.ctx);
  }

  // ---------- seeding, import, persistence ----------
  seed() {
    const m = this.manifest;
    for (const [name, value] of Object.entries(m.properties)) this._put("sys_properties", { name, value });
    this._put("sys_properties", { name: "glide.servlet.uri", value: this.baseUrl });
    for (const name of m.groups) this._put("sys_user_group", { name });
    for (const u of m.users) {
      this._put("sys_user", { user_name: u.user_name, name: u.name, password: u.password, roles: u.roles.join(",") });
    }
    const prop = { "x_tp.test_integration_password": "triage-local", "x_tp.test_employee_password": "emp-local", "x_tp.test_agent_password": "agent-local" };
    for (const [name, value] of Object.entries(prop)) this._put("sys_properties", { name, value });
    const arts = JSON.parse(this._read("seed/kb_articles.json"));
    for (const a of arts) {
      this._put("kb_knowledge", { number: a.number, short_description: a.title, text: a.text, workflow_state: "published", u_category: a.category });
    }
    this.counters.KB = Math.max(this.counters.KB || 0, 20000);
  }

  _put(table, rec) {
    const id = this.newId();
    this.table(table).set(id, { sys_id: id, sys_created_on: nowStamp(), sys_updated_on: nowStamp(), sys_mod_count: "0", _seq: ++this.seq, ...rec });
    this.dirty = true;
  }

  importTickets(rows) {
    const map = JSON.parse(this._read("import/transform_map.json"));
    const script = this._read("import/transform_on_before.js");
    this.noRules = !map.run_business_rules ? true : false;
    let loaded = 0;
    const log = { warn: (m) => this._syslog("warn", m), info: () => {}, error: (m) => this._syslog("error", m) };
    try {
      for (const row of rows) {
        const stage = this.glideRecord("x_tp_ticket_import");
        stage.initialize();
        stage.setValue("ticket_id", row.ticket_id);
        stage.setValue("document", row.document);
        stage.setValue("topic_group", row.topic_group);
        stage.insert();
        const source = { ticket_id: row.ticket_id, document: row.document, topic_group: row.topic_group };
        const target = this.glideRecord("incident");
        target.initialize();
        for (const f of map.field_map) target.setValue(f.target, source[f.source]);
        this.ctx.ignore = false;
        this._exec(script, { source, map, log, target }, "transform");
        if (this.ctx.ignore) continue;
        target.insert();
        loaded++;
      }
    } finally {
      this.noRules = false;
    }
    return loaded;
  }

  save(file) {
    const out = { counters: this.counters, seq: this.seq, tables: {} };
    for (const [t, m] of Object.entries(this.tables)) out.tables[t] = [...m.values()];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out));
    this.dirty = false;
  }

  load(file) {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    this.counters = d.counters;
    this.seq = d.seq;
    for (const [t, rows] of Object.entries(d.tables)) {
      const m = this.table(t);
      for (const r of rows) m.set(r.sys_id, r);
    }
  }
}

module.exports = { Instance, nowStamp };

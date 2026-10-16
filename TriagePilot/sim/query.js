// Encoded-query parsing and matching for the local instance.

const OPS = [
  ["ISNOTEMPTY", "isnotempty"],
  ["ISEMPTY", "isempty"],
  ["STARTSWITH", "startswith"],
  ["ENDSWITH", "endswith"],
  ["NOT LIKE", "notlike"],
  ["LIKE", "like"],
  ["!=", "ne"],
  [">=", "gte"],
  ["<=", "lte"],
  ["IN", "in"],
  ["=", "eq"],
  [">", "gt"],
  ["<", "lt"],
];

function parseCondition(text) {
  const m = /^([A-Za-z0-9_.]+?)(ISNOTEMPTY|ISEMPTY|STARTSWITH|ENDSWITH|NOT LIKE|LIKE|!=|>=|<=|IN|=|>|<)(.*)$/.exec(text);
  if (!m) throw new Error(`cannot parse condition: ${text}`);
  const op = OPS.find((o) => o[0] === m[2])[1];
  return { field: m[1], op, value: m[3] };
}

// Returns { clauses: [[cond, ...OR'd], ...AND'd], order: [{field, desc}] }
function parseEncoded(query) {
  const out = { clauses: [], order: [] };
  if (!query) return out;
  for (const token of query.split("^")) {
    if (!token || token === "NQ") continue;
    if (token.startsWith("ORDERBYDESC")) out.order.push({ field: token.slice(11), desc: true });
    else if (token.startsWith("ORDERBY")) out.order.push({ field: token.slice(7), desc: false });
    else if (token.startsWith("OR")) {
      const cond = parseCondition(token.slice(2));
      if (out.clauses.length) out.clauses[out.clauses.length - 1].push(cond);
      else out.clauses.push([cond]);
    } else out.clauses.push([parseCondition(token)]);
  }
  return out;
}

function compare(a, b) {
  const na = Number(a), nb = Number(b);
  if (a !== "" && b !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchCondition(rec, c) {
  const raw = rec[c.field];
  const v = raw === undefined || raw === null ? "" : String(raw);
  switch (c.op) {
    case "eq": return v === c.value || (c.value === "false" && v === "");
    case "ne": return v !== c.value;
    case "gt": return compare(v, c.value) > 0;
    case "lt": return compare(v, c.value) < 0;
    case "gte": return compare(v, c.value) >= 0;
    case "lte": return compare(v, c.value) <= 0;
    case "like": return v.toLowerCase().includes(c.value.toLowerCase());
    case "notlike": return !v.toLowerCase().includes(c.value.toLowerCase());
    case "startswith": return v.toLowerCase().startsWith(c.value.toLowerCase());
    case "endswith": return v.toLowerCase().endsWith(c.value.toLowerCase());
    case "in": return c.value.split(",").includes(v);
    case "isempty": return v === "";
    case "isnotempty": return v !== "";
    default: return false;
  }
}

function matches(rec, clauses) {
  return clauses.every((group) => group.some((c) => matchCondition(rec, c)));
}

function sortRows(rows, order) {
  if (!order.length) return rows;
  return rows.sort((x, y) => {
    for (const o of order) {
      const key = o.field === "sys_created_on" ? "_seq" : o.field;
      const d = compare(String(x[key] ?? ""), String(y[key] ?? ""));
      if (d) return o.desc ? -d : d;
    }
    return 0;
  });
}

module.exports = { parseEncoded, matches, sortRows, matchCondition };

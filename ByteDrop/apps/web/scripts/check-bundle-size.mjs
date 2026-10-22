// Fails the build when client JavaScript grows past the budgets below (gzip sizes, in KB).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const dist = process.env.NEXT_DIST_DIR ?? ".next";
const budgets = {
  // Framework, router and shared runtime loaded on every page.
  baseline: Number(process.env.BUDGET_BASELINE_KB ?? 150),
  // Biggest single chunk (the charting library, loaded only on the analytics page).
  largestChunk: Number(process.env.BUDGET_LARGEST_KB ?? 130),
  // Everything the app ships to browsers, across all routes.
  total: Number(process.env.BUDGET_TOTAL_KB ?? 650),
};

const gz = (file) => gzipSync(readFileSync(file)).length;
const kb = (n) => n / 1024;

const manifest = JSON.parse(readFileSync(path.join(dist, "build-manifest.json"), "utf8"));
const baseline = manifest.rootMainFiles.reduce((sum, f) => sum + gz(path.join(dist, f)), 0);

const chunks = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (full.endsWith(".js")) chunks.push({ file: path.relative(dist, full), size: gz(full) });
  }
})(path.join(dist, "static", "chunks"));
chunks.sort((a, b) => b.size - a.size);

const total = chunks.reduce((sum, c) => sum + c.size, 0);
const rows = [
  ["Shared baseline (every page)", kb(baseline), budgets.baseline],
  ["Largest chunk", kb(chunks[0]?.size ?? 0), budgets.largestChunk],
  ["All client JavaScript", kb(total), budgets.total],
];

let failed = false;
console.log(`Bundle size (${dist}, gzip)`);
for (const [label, size, limit] of rows) {
  const ok = size <= limit;
  failed ||= !ok;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(32)} ${size.toFixed(1).padStart(7)} KB  (limit ${limit} KB)`);
}
console.log("  Largest chunks:");
for (const c of chunks.slice(0, 5)) console.log(`    ${kb(c.size).toFixed(1).padStart(7)} KB  ${c.file}`);

if (failed) {
  console.error("\nBundle budget exceeded. Trim the dependency or raise the limit on purpose, with a note in the change.");
  process.exit(1);
}

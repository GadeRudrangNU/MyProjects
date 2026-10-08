// Generates the static sandbox pages from src/sandbox/*. Run automatically before dev and build.
//
// The pages are separate files (not srcdoc) so they can carry their own Content-Security-Policy,
// independent of the app's. Inside <iframe sandbox="allow-scripts"> they also get an opaque origin.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const host = read('src/sandbox/host.js');

export const SANDBOXES = {
  js: {
    worker: 'src/sandbox/worker-js.js',
    persistent: false,
    // No network of any kind: user code cannot send data anywhere.
    csp: "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'",
  },
  py: {
    worker: 'src/sandbox/worker-py.js',
    persistent: true,
    // Pyodide itself must be fetched from its pinned CDN; nothing else is reachable.
    csp: "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net; worker-src blob:; connect-src https://cdn.jsdelivr.net",
  },
};

// JSON string safe to embed inside an inline <script>.
const BS = String.fromCharCode(92); // a backslash, built from its code so no editor or tool can unescape it
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const embed = (s) =>
  JSON.stringify(s)
    .replaceAll('<', BS + 'u003c')
    .replaceAll(LS, BS + 'u2028')
    .replaceAll(PS, BS + 'u2029');

mkdirSync(resolve(root, 'public/sandbox'), { recursive: true });
for (const [name, cfg] of Object.entries(SANDBOXES)) {
  const script = host
    .replace('__CONFIG__', JSON.stringify({ persistent: cfg.persistent }))
    .replace('__WORKER_SOURCE__', embed(read(cfg.worker)));
  if (/__[A-Z_]+__/.test(script.replace(/__proto__/g, ''))) throw new Error(`unreplaced placeholder in ${name} sandbox`);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${cfg.csp}">
<title>Quack-Code sandbox (${name})</title>
</head>
<body>
<script>window.addEventListener('error', (e) => window.parent.postMessage({ type: 'fatal', message: String(e.message) }, '*'));</script>
<script>${script.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
  writeFileSync(resolve(root, `public/sandbox/${name}.html`), html);
}
console.log('sandbox pages generated');

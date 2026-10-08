// Runs inside a Web Worker inside a sandboxed iframe. Pyodide is fetched from a pinned CDN version
// the first time Python runs, so it never affects the initial page load.
'use strict';

const INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
const send = (m) => self.postMessage(m);
let pyodidePromise = null;

function getPyodide() {
  if (!pyodidePromise) {
    send({ type: 'status', text: 'Loading Python runtime (first run only)…' });
    importScripts(INDEX_URL + 'pyodide.js');
    pyodidePromise = self.loadPyodide({ indexURL: INDEX_URL }).then((py) => {
      py.setStdout({ batched: (text) => send({ type: 'log', level: 'log', text }) });
      py.setStderr({ batched: (text) => send({ type: 'log', level: 'error', text }) });
      try {
        py.setStdin({ stdin: () => undefined });
      } catch {
        /* older runtimes: input() will raise instead of returning EOF */
      }
      return py;
    });
  }
  return pyodidePromise;
}

// Pyodide's tracebacks include its own bootstrap frames, which only add noise for users.
function cleanTraceback(msg) {
  const lines = String(msg).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/File "[^"]*\/(_pyodide|pyodide)\//.test(lines[i])) {
      while (i + 1 < lines.length && /^ {4}/.test(lines[i + 1])) i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

self.onmessage = async (e) => {
  let py;
  try {
    py = await getPyodide();
  } catch (err) {
    pyodidePromise = null;
    send({ type: 'error', message: 'Could not load the Python runtime: ' + (err && err.message ? err.message : err), stack: '' });
    send({ type: 'done', status: 'error', ms: 0 });
    return;
  }
  send({ type: 'started' });
  const t0 = performance.now();
  const ns = py.globals.get('dict')();
  try {
    await py.runPythonAsync(e.data.code, { globals: ns });
    send({ type: 'done', status: 'ok', ms: Math.round(performance.now() - t0) });
  } catch (err) {
    send({ type: 'error', message: cleanTraceback(err && err.message ? err.message : err), stack: '' });
    send({ type: 'done', status: 'error', ms: Math.round(performance.now() - t0) });
  } finally {
    ns.destroy();
  }
};

// Runs in the sandboxed iframe's top frame. It owns the worker and relays messages to the app.
// Template placeholders are filled in by scripts/build-sandbox.mjs.
(() => {
  'use strict';
  const CFG = __CONFIG__;
  const WORKER_SRC = __WORKER_SOURCE__;
  const MAX_LINES = 2000;
  const MAX_BYTES = 262144;
  const LOAD_TIMEOUT_MS = 90000;

  const parentWin = window.parent;
  const post = (m) => parentWin.postMessage(m, '*');

  let worker = null;
  let workerUrl = null;
  let timer = null;
  let loadTimer = null;
  let current = null;
  let lines = 0;
  let bytes = 0;

  const clearTimers = () => {
    clearTimeout(timer);
    clearTimeout(loadTimer);
    timer = loadTimer = null;
  };

  function killWorker() {
    clearTimers();
    if (worker) worker.terminate();
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    worker = workerUrl = null;
  }

  function finish(status, ms) {
    if (!current) return;
    const id = current.id;
    clearTimers();
    current = null;
    // Python keeps its (slow to load) runtime between clean runs; everything else starts fresh.
    if (!CFG.persistent || (status !== 'ok' && status !== 'error')) killWorker();
    post({ type: 'done', id, status, ms: ms == null ? 0 : ms });
  }

  function onWorkerMessage(ev) {
    const d = ev.data;
    if (!current || !d) return;
    const id = current.id;
    switch (d.type) {
      case 'started':
        clearTimeout(loadTimer);
        timer = setTimeout(() => finish('timeout', current && current.timeoutMs), current.timeoutMs);
        break;
      case 'status':
        post({ type: 'status', id, text: String(d.text) });
        break;
      case 'log': {
        lines++;
        bytes += String(d.text).length;
        if (lines > MAX_LINES || bytes > MAX_BYTES) {
          post({ type: 'log', id, level: 'warn', text: 'Output limit reached; the run was stopped.' });
          finish('limit');
          break;
        }
        post({ type: 'log', id, level: d.level, text: String(d.text) });
        break;
      }
      case 'error':
        post({ type: 'error', id, message: String(d.message), stack: String(d.stack || '') });
        break;
      case 'done':
        finish(d.status, d.ms);
        break;
    }
  }

  function ensureWorker() {
    if (worker) return;
    workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    worker = new Worker(workerUrl);
    worker.onmessage = onWorkerMessage;
    worker.onerror = (ev) => {
      ev.preventDefault();
      if (current) post({ type: 'error', id: current.id, message: ev.message || 'The sandbox worker crashed', stack: '' });
      finish('error');
    };
  }

  function run(msg) {
    if (current) finish('stopped');
    current = { id: msg.id, timeoutMs: Math.min(Math.max(Number(msg.timeoutMs) || 10000, 500), 60000) };
    lines = bytes = 0;
    try {
      ensureWorker();
    } catch (err) {
      post({ type: 'error', id: msg.id, message: 'Could not start the sandbox: ' + err.message, stack: '' });
      finish('error');
      return;
    }
    loadTimer = setTimeout(() => finish('timeout'), LOAD_TIMEOUT_MS);
    worker.postMessage({ code: String(msg.code) });
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== parentWin || !ev.data) return;
    if (ev.data.type === 'run') run(ev.data);
    else if (ev.data.type === 'stop') finish('stopped');
  });

  post({ type: 'ready' });
})();

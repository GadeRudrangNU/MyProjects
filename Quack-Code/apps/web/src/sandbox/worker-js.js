// Runs inside a Web Worker inside a sandboxed iframe. Plain JS (not TS) because it is shipped as text.
'use strict';

const MAX_DEPTH = 3;
const MAX_ITEMS = 100;
const MAX_STR = 10000;

function ctorName(o) {
  try {
    return (o.constructor && o.constructor.name) || 'Object';
  } catch {
    return 'Object';
  }
}

function fmt(v, top, depth, seen) {
  switch (typeof v) {
    case 'string': {
      if (top) return v.length > MAX_STR ? v.slice(0, MAX_STR) + '…' : v;
      return JSON.stringify(v.length > MAX_STR ? v.slice(0, MAX_STR) + '…' : v);
    }
    case 'number':
      return Object.is(v, -0) ? '-0' : String(v);
    case 'bigint':
      return v + 'n';
    case 'symbol':
      return v.toString();
    case 'undefined':
      return 'undefined';
    case 'boolean':
      return String(v);
    case 'function':
      return /^class\s/.test(Function.prototype.toString.call(v))
        ? '[class ' + (v.name || 'anonymous') + ']'
        : '[Function: ' + (v.name || 'anonymous') + ']';
  }
  if (v === null) return 'null';
  if (seen.includes(v)) return '[Circular]';
  if (v instanceof Error) return v.stack || v.name + ': ' + v.message;
  if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
  if (v instanceof RegExp) return String(v);
  if (v instanceof Promise) return 'Promise { … }';
  const isArr = Array.isArray(v);
  if (depth >= MAX_DEPTH) return isArr ? '[Array]' : '[' + ctorName(v) + ']';
  seen = seen.concat([v]);
  const sub = (x) => fmt(x, false, depth + 1, seen);
  try {
    if (isArr) {
      const items = v.slice(0, MAX_ITEMS).map(sub);
      if (v.length > MAX_ITEMS) items.push('… ' + (v.length - MAX_ITEMS) + ' more items');
      return items.length ? '[ ' + items.join(', ') + ' ]' : '[]';
    }
    if (v instanceof Map) {
      const items = [...v].slice(0, MAX_ITEMS).map(([k, x]) => sub(k) + ' => ' + sub(x));
      return 'Map(' + v.size + ') { ' + items.join(', ') + ' }';
    }
    if (v instanceof Set) {
      return 'Set(' + v.size + ') { ' + [...v].slice(0, MAX_ITEMS).map(sub).join(', ') + ' }';
    }
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      return ctorName(v) + '(' + v.length + ') [ ' + Array.from(v).slice(0, MAX_ITEMS).join(', ') + ' ]';
    }
    const keys = Object.keys(v);
    const items = keys.slice(0, MAX_ITEMS).map((k) => {
      let val;
      try {
        val = sub(v[k]);
      } catch {
        val = '[Getter threw]';
      }
      return (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ': ' + val;
    });
    if (keys.length > MAX_ITEMS) items.push('… ' + (keys.length - MAX_ITEMS) + ' more keys');
    const name = ctorName(v);
    const body = items.length ? '{ ' + items.join(', ') + ' }' : '{}';
    return name === 'Object' ? body : name + ' ' + body;
  } catch {
    return '[' + ctorName(v) + ']';
  }
}

const send = (m) => self.postMessage(m);
const render = (args) => args.map((a) => fmt(a, true, 0, [])).join(' ');

function makeConsole() {
  const c = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    c[level] = (...args) => send({ type: 'log', level, text: render(args) });
  }
  c.table = c.log;
  c.dir = c.log;
  c.trace = c.log;
  c.assert = (cond, ...args) => {
    if (!cond) send({ type: 'log', level: 'error', text: 'Assertion failed' + (args.length ? ': ' + render(args) : '') });
  };
  c.clear = () => {};
  return c;
}

function reportError(err) {
  const isErr = err instanceof Error;
  send({
    type: 'error',
    message: isErr ? err.name + ': ' + err.message : 'Uncaught ' + render([err]),
    stack: isErr ? String(err.stack || '') : '',
  });
}

self.addEventListener('unhandledrejection', (ev) => {
  reportError(ev.reason);
});
self.addEventListener('error', (ev) => {
  if (ev.preventDefault) ev.preventDefault();
  reportError(ev.error || ev.message);
});

self.onmessage = async (e) => {
  const t0 = performance.now();
  // Tracked timers let a script that schedules work finish naturally instead of being cut off at once.
  const pending = new Set();
  let mainDone = false;
  let finished = false;
  const finish = (status) => {
    if (finished) return;
    finished = true;
    send({ type: 'done', status, ms: Math.round(performance.now() - t0) });
  };
  const check = () => {
    if (mainDone && pending.size === 0) finish('ok');
  };
  const wrapTimeout = (cb, ms, ...args) => {
    const id = setTimeout(() => {
      pending.delete(id);
      try {
        if (typeof cb === 'function') cb(...args);
      } catch (err) {
        reportError(err);
      }
      check();
    }, ms);
    pending.add(id);
    return id;
  };
  const wrapInterval = (cb, ms, ...args) => {
    const id = setInterval(() => {
      try {
        if (typeof cb === 'function') cb(...args);
      } catch (err) {
        reportError(err);
      }
    }, ms);
    pending.add(id);
    return id;
  };
  const clear = (id) => {
    pending.delete(id);
    clearTimeout(id);
    clearInterval(id);
    check();
  };

  send({ type: 'started' });
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', e.data.code);
    await fn(makeConsole(), wrapTimeout, wrapInterval, clear, clear);
    mainDone = true;
    check();
  } catch (err) {
    reportError(err);
    pending.forEach((id) => {
      clearTimeout(id);
      clearInterval(id);
    });
    pending.clear();
    finish('error');
  }
};

# 2. Run code in the browser, never on the server

**Status:** accepted

## Context
Users can run JavaScript and Python. Running arbitrary code server-side needs containers, quotas and abuse handling, which a free-tier project cannot afford or safely operate.

## Decision
Execute entirely in the browser: JavaScript in a Web Worker, Python in Pyodide. Each runs inside `<iframe sandbox="allow-scripts">` (opaque origin). Timeouts terminate the worker.

## Why
- Free, and user code cannot touch the backend or other users' data.
- The sandbox page is a separate static file with its own CSP: no network at all for JavaScript, and only the pinned Pyodide CDN for Python.

## Consequences
- No server-side languages and no access to the user's files except the one being run.
- Python needs internet access on first use (~8 s to load).
- Pyodide's own bundle is fetched from a CDN, so the version is pinned in `worker-py.js`.

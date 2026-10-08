# 1. Use Yjs (a CRDT) for collaborative editing

**Status:** accepted

## Context
Several people must edit one file at once, including while offline, and every client must end up with the same text.

## Decision
Use Yjs with CodeMirror 6 (`y-codemirror.next`). Writing a custom CRDT or operational-transform engine is out of scope.

## Why
- Offline edits merge without a central ordering server, which is exactly the offline requirement.
- Yjs gives per-user undo (`Y.UndoManager`) so undo never reverts a collaborator's change.
- The awareness protocol carries cursors and presence without persisting them.
- OT would need the server to be the single source of order and is harder to make work offline.

## Consequences
- Document history grows over time (Yjs keeps tombstones). A compaction job is planned.
- The server speaks the y-websocket wire protocol itself rather than using the stock server, so it can check roles on every connection and drop viewer writes.

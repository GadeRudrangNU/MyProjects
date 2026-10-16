# Running TriagePilot

Everything here is free and runs on one machine. No card, no paid service.

## Once

1. Python 3.11, Node 22, and [Ollama](https://ollama.com).
2. `ollama pull qwen2.5:7b` (use `qwen2.5:3b` on 8 GB of RAM and set `TP_LLM_MODEL=qwen2.5:3b`).
3. Python environment:
   ```
   python -m venv .venv
   .venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cpu
   .venv/Scripts/pip install -e "agent[dev]"
   ```
4. Download the CC0 dataset from
   https://www.kaggle.com/datasets/adisongoh/it-service-ticket-classification-dataset
   and unzip it to `data/raw/`.
5. Build the model and the indexes:
   ```
   python training/prepare.py
   python training/train.py
   python training/index_tickets.py
   ```

## Start the stack

```
python scripts/stack.py up --fresh
```

This starts the local instance on http://127.0.0.1:8070 (users: `desk.agent` / `agent-local`,
`admin` / `admin-local`, `emp.beth` / `emp-local`) and the agent on http://127.0.0.1:8000.
Add `--exclude-test` when replaying held-out tickets, so the agent cannot find the ticket it is being scored on.
`python scripts/stack.py down` stops both.

## Tests

```
cd agent && pytest                   # agent: schemas, graph, validation, API, clients
node --test sim/tests/instance.test.js sim/tests/server.test.js   # ServiceNow scripts on the local instance
node sim/cli.js atf                  # the ATF-style suite in servicenow/atf
```

The agent tests use stubbed model answers, so they are repeatable. To record real answers for a test,
set `TP_LLM_MODE=record`; `TP_LLM_MODE=replay` plays them back.

## Measurements

```
python training/evaluate.py          # classifier vs zero-shot LLM vs hybrid, plus the hand-written set
python eval/replay.py --n 200        # replays held-out tickets through the running stack
node tools/record-gifs.mjs           # records the workflow GIFs (needs `npm install` in tools/)
```

## Using a real ServiceNow developer instance

The files under `servicenow/` are the app. `manifest.json` lists every table, field, business rule,
Scripted REST resource, ACL, flow, UI action and system property, and each script is in its own file.
Point the agent at the instance with `TP_SN_URL`, `TP_SN_USER` and `TP_SN_PASSWORD`, and set the system
property `x_tp.agent_url` to the tunnel address (`cloudflared tunnel --url http://localhost:8000`).
The URL changes each time the tunnel restarts, which is why it lives in a property and not in a script.

An optional PostgreSQL with pgvector is described in `docker-compose.yml`; set `TP_VECTOR_BACKEND=pgvector`.

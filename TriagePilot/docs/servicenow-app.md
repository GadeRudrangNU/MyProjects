# The ServiceNow app

Scope `x_tp`. Everything is in `servicenow/`, one file per script, and `manifest.json` ties it together.
The scripts are plain ES5 so they run on the platform's default JavaScript engine.

## Data

| Table | Purpose |
|---|---|
| `x_tp_ai_triage_run` | One row per run: status, suggested category and group, confidence, path (fast or LLM), draft reply, cited articles, similar tickets, latency, step trace, outcome |
| `x_tp_ai_feedback` | Accept, reject (with reason) and re-run decisions |
| `x_tp_knowledge_draft` | What the knowledge agent did for each resolved incident |
| `x_tp_ticket_import` | Import set staging table for the 3,000 historical tickets |

Fields added to `incident`: `u_imported`, `u_ai_suggestion_state`, `u_final_category`, `u_corpus_ref`, `u_reject_reason`.
The eight dataset categories are used as incident categories, each with its own assignment group.

## Behaviour

| Piece | File | What it does |
|---|---|---|
| Business rule (async, insert, `u_imported=false`) | `business_rules/triage_on_insert.js` | Calls `TriageClient.queueRun` |
| Script include | `script_includes/TriageClient.js` | Scrubs emails, phones and IPs, creates the run (`queued`), posts to the agent. The run key is `sys_id:sys_mod_count`, so a repeated trigger returns the same run |
| Script include | `script_includes/TriagePII.js` | The scrubber, checked against the same test cases as the Python one (`shared/pii_cases.json`) |
| Scripted REST | `scripted_rest/triage_result.js` | Receives the agent's result. Needs role `x_tp_integration`. Validates the body and ignores a repeat |
| Flow | `flows/route_triage_result.json` + `script_includes/TriageRouter.js` | When a run changes status: auto-route when confidence is at least `x_tp.auto_route_threshold` and priority is 3 or 4, otherwise create an approval for the Service Desk |
| Client script + UI actions | `client_scripts/`, `ui_actions/` | Banner on the incident form, Accept, Reject (reason required), Re-run |
| Script include | `script_includes/TriageFeedback.js` | Applies or rejects the suggestion and logs it; also used when an approval is decided in the approval list |
| Business rules | `business_rules/capture_final_category.js`, `draft_article_on_resolve.js` | Remember the category the incident was resolved with and ask the agent for a knowledge article |
| Script include + Scripted REST | `script_includes/TriageMetrics.js`, `scripted_rest/metrics.js` | Numbers for the dashboard |
| ACLs | `manifest.json` (`acls`) | Only the integration user can write runs; agents can read them; employees can only create incidents |
| ATF | `atf/` | Five tests: run is queued, callback updates the run, low confidence creates an approval, ACLs block the wrong users, duplicate trigger makes one run |

## System properties

| Property | Meaning |
|---|---|
| `x_tp.agent_url` | Public address of the agent (the tunnel URL). Kept in a property because it changes on every tunnel restart |
| `x_tp.agent_token` | Bearer token the agent expects |
| `x_tp.auto_route_threshold` | Confidence needed to route without a person (default 0.85) |
| `x_tp.approval_group` | Group that receives approvals |

## Import

`import/transform_map.json` and `import/transform_on_before.js` load the CSV into the staging table and map each row to a
resolved incident with the matching category and group. Business rules are switched off for the load, and every row is
flagged `u_imported` so the triage rule skips it.

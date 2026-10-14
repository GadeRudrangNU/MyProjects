import { Banknote, CheckCircle2, Play, XCircle } from "lucide-react";
import { useState } from "react";
import { useAccounts } from "../accounts-context";
import { api } from "../api";
import { Card, Empty, ErrorBanner, errorText, StatusBadge, useToast } from "../components/ui";
import { dateTime, money } from "../format";
import { usePolling } from "../hooks";
import type { Page, ReconciliationRun, Settlement } from "../types";

export function ReconciliationPage() {
  const runs = usePolling(() => api<Page<ReconciliationRun>>("/reconciliation/runs", { params: { limit: 15 } }), 4000);
  const settlements = usePolling(() => api<Page<Settlement>>("/settlements", { params: { limit: 15 } }), 4000);
  const { name, refresh: refreshAccounts } = useAccounts();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const latest = runs.data?.results[0];

  const run = async () => {
    setBusy("recon");
    try {
      const r = await api<ReconciliationRun>("/reconciliation/runs", { method: "POST" });
      toast(r.status === "ok" ? "Reconciliation passed: every balance matches its entries" : `Reconciliation found ${r.mismatch_count} problems`, r.status === "ok" ? "ok" : "bad");
      await runs.refresh();
    } catch (e) { toast(errorText(e), "bad"); } finally { setBusy(""); }
  };

  const settle = async () => {
    setBusy("settle");
    try {
      const s = await api<Settlement[]>("/settlements/run", { method: "POST", body: { delay_seconds: 0 } });
      toast(s.length ? `Paid out ${s.length} merchant${s.length > 1 ? "s" : ""}` : "Nothing to settle");
      await Promise.all([settlements.refresh(), refreshAccounts()]);
    } catch (e) { toast(errorText(e), "bad"); } finally { setBusy(""); }
  };

  return (
    <>
      <ErrorBanner error={runs.error} />
      {latest && (
        <div className={`alert ${latest.status === "ok" ? "ok" : "bad"}`}>
          {latest.status === "ok" ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
          <div>
            <b>{latest.status === "ok" ? "Ledger is consistent." : `${latest.mismatch_count} problems found.`}</b>{" "}
            Last run {dateTime(latest.finished_at)}: checked {latest.accounts_checked} accounts and {latest.transactions_checked} ledger transactions.
          </div>
        </div>
      )}
      <Card
        title="Reconciliation runs"
        sub="Re-derives every balance from the ledger entries and compares. It also checks that each transaction sums to zero and that each captured payment was credited once. Runs nightly via Celery beat."
        action={<button className="btn primary" disabled={busy === "recon"} onClick={run}><Play size={15} /> {busy === "recon" ? "Running…" : "Run now"}</button>}
        flush
      >
        {runs.data && runs.data.results.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Started</th><th>Result</th><th className="right">Accounts</th><th className="right">Ledger transactions</th><th className="right">Findings</th></tr></thead>
              <tbody>
                {runs.data.results.map((r) => (
                  <tr key={r.id}>
                    <td>{dateTime(r.started_at)}</td>
                    <td><StatusBadge status={r.status === "ok" ? "captured" : "failed"} label={r.status === "ok" ? "Balanced" : "Mismatch"} /></td>
                    <td className="right num">{r.accounts_checked}</td><td className="right num">{r.transactions_checked}</td>
                    <td className="right num">
                      {r.mismatch_count}
                      {r.findings.slice(0, 3).map((f, i) => <div key={i} className="mono muted" style={{ textAlign: "left" }}>{JSON.stringify(f)}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No runs yet">Click “Run now” to check the ledger.</Empty>}
      </Card>

      <Card
        title="Settlement payouts"
        sub="Captured payments are swept from each merchant account to the bank as one payout, net of refunds. Normally nightly with a delay; this button settles everything captured so far."
        action={<button className="btn" disabled={busy === "settle"} onClick={settle}><Banknote size={15} /> Settle now</button>}
        flush
      >
        {settlements.data && settlements.data.results.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Created</th><th>Merchant</th><th className="right">Payments</th><th className="right">Net payout</th></tr></thead>
              <tbody>
                {settlements.data.results.map((s) => (
                  <tr key={s.id}><td>{dateTime(s.created_at)}</td><td>{name(s.account_id)}</td><td className="right num">{s.payment_count}</td><td className="right num"><b>{money(s.amount)}</b></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No payouts yet" />}
      </Card>
    </>
  );
}

import { CheckCircle2, Plus } from "lucide-react";
import { useState } from "react";
import { useAccounts } from "../accounts-context";
import { api, newIdempotencyKey } from "../api";
import { Badge, Card, Drawer, Empty, errorText, Modal, useToast } from "../components/ui";
import { dateTime, money } from "../format";
import { usePolling } from "../hooks";
import type { Account, LedgerEntry, Page } from "../types";

const KIND_LABEL: Record<string, string> = { customer: "Customer", merchant: "Merchant", external: "External (system)", holds: "Auth holds (system)" };

export function AccountsPage() {
  const { accounts, refresh, name, loaded } = useAccounts();
  const toast = useToast();
  const [kind, setKind] = useState("");
  const [creating, setCreating] = useState(false);
  const [depositTo, setDepositTo] = useState<Account>();
  const [viewing, setViewing] = useState<Account>();

  const shown = accounts.filter((a) => !kind || a.kind === kind);
  const ledgerTotal = accounts.reduce((sum, a) => sum + a.balance, 0);

  return (
    <>
      <div className="row between">
        <div className="tabs" role="tablist">
          {[["", "All"], ["customer", "Customers"], ["merchant", "Merchants"], ["external", "System"]].map(([k, label]) => (
            <button key={k} className={`tab ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> New account</button>
      </div>

      <div className={`alert ${ledgerTotal === 0 ? "ok" : "bad"}`} hidden={!loaded}>
        <CheckCircle2 size={18} />
        <div>
          <b>Double-entry check: all balances sum to {money(ledgerTotal)}.</b>{" "}
          Every transfer is a debit and a credit of the same size, so the books always add up to zero. Customer and merchant balances are
          mirrored by the system accounts (external funding and holds).
        </div>
      </div>

      <Card flush>
        {!loaded ? <Empty title="Loading�" /> : shown.length === 0 ? <Empty title="No accounts yet">Create a customer and a merchant to start taking payments.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Account</th><th>Type</th><th>Currency</th><th className="right">Balance</th><th>Created</th><th /></tr></thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id} className="click" onClick={() => setViewing(a)}>
                    <td><b>{a.name}</b><div className="mono muted">{a.id.slice(0, 8)}</div></td>
                    <td><Badge tone={a.kind === "customer" ? "info" : a.kind === "merchant" ? "ok" : "neutral"}>{KIND_LABEL[a.kind]}</Badge></td>
                    <td>{a.currency}</td>
                    <td className={`right num ${a.balance < 0 ? "neg" : ""}`}><b>{money(a.balance)}</b></td>
                    <td className="muted">{dateTime(a.created_at)}</td>
                    <td className="right" onClick={(e) => e.stopPropagation()}>
                      {(a.kind === "customer" || a.kind === "merchant") && <button className="btn small" onClick={() => setDepositTo(a)}>Deposit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && <CreateAccount onClose={() => setCreating(false)} onDone={() => { setCreating(false); void refresh(); toast("Account created"); }} />}
      {depositTo && <Deposit account={depositTo} onClose={() => setDepositTo(undefined)} onDone={() => { setDepositTo(undefined); void refresh(); toast("Deposit posted to the ledger"); }} />}
      {viewing && <AccountDrawer account={viewing} name={name} onClose={() => setViewing(undefined)} />}
    </>
  );
}

function CreateAccount({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [accountName, setName] = useState("");
  const [kind, setKind] = useState("customer");
  const [error, setError] = useState<string>();
  const submit = async () => {
    try {
      await api("/accounts", { method: "POST", body: { name: accountName.trim(), kind } });
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal title="New account" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!accountName.trim()} onClick={submit}>Create</button></>}>
      {error && <div className="alert bad">{error}</div>}
      <label className="field">Name<input className="input" autoFocus value={accountName} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan Lee" /></label>
      <label className="field">Type
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="customer">Customer (pays)</option><option value="merchant">Merchant (gets paid)</option>
        </select>
      </label>
    </Modal>
  );
}

function Deposit({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("100.00");
  const [error, setError] = useState<string>();
  const cents = Math.round(parseFloat(amount) * 100);
  const submit = async () => {
    try {
      await api(`/accounts/${account.id}/deposit`, { method: "POST", idempotencyKey: newIdempotencyKey(), body: { amount: cents } });
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal title={`Deposit to ${account.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!(cents > 0)} onClick={submit}>Deposit</button></>}>
      {error && <div className="alert bad">{error}</div>}
      <div className="muted">Moves money from the external funding account into this account as a balanced ledger transaction.</div>
      <label className="field">Amount (USD)<input className="input num" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
    </Modal>
  );
}

function AccountDrawer({ account, onClose, name }: { account: Account; onClose: () => void; name: (id: string) => string }) {
  const entries = usePolling(() => api<Page<LedgerEntry>>(`/accounts/${account.id}/entries`, { params: { limit: 50 } }), 4000, [account.id]);
  const balance = usePolling(() => api<{ balance: number }>(`/accounts/${account.id}/balance`), 4000, [account.id]);
  void name;
  return (
    <Drawer title={account.name} subtitle={`${KIND_LABEL[account.kind]} · ${account.currency}`} onClose={onClose}>
      <div>
        <div className="section-title">Balance derived from ledger entries</div>
        <div style={{ fontSize: 30, fontWeight: 700 }} className="num">{balance.data ? money(balance.data.balance) : "–"}</div>
        <div className="muted">Computed as the sum of this account's entries; no balance field is ever overwritten.</div>
      </div>
      <div>
        <div className="section-title">Recent entries</div>
        {entries.data?.results.length ? entries.data.results.map((e) => (
          <div className="entry" key={e.id}>
            <span><span className="mono muted">#{e.id}</span> · {dateTime(e.created_at)}</span>
            <span className={`num ${e.amount < 0 ? "neg" : "pos"}`}>{money(e.amount, true)}</span>
          </div>
        )) : <div className="muted">No entries yet.</div>}
      </div>
    </Drawer>
  );
}

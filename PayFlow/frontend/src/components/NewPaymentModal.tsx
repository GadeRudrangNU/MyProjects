import { Repeat, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { useAccounts } from "../accounts-context";
import { api, newIdempotencyKey } from "../api";
import { money } from "../format";
import type { Payment } from "../types";
import { Badge, errorText, Modal, PaymentStatus, useToast } from "./ui";

export function NewPaymentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { accounts, name, refresh } = useAccounts();
  const toast = useToast();
  const customers = useMemo(() => accounts.filter((a) => a.kind === "customer"), [accounts]);
  const merchants = useMemo(() => accounts.filter((a) => a.kind === "merchant"), [accounts]);
  const [payer, setPayer] = useState("");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("25.00");
  const [device, setDevice] = useState("web-chrome-01");
  const [capture, setCapture] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ payment: Payment; key: string; replays: number }>();

  const payerId = payer || customers[0]?.id || "";
  const payeeId = payee || merchants[0]?.id || "";
  const cents = Math.round(parseFloat(amount) * 100);
  const valid = payerId && payeeId && Number.isFinite(cents) && cents > 0;

  const send = async (key: string, replays = 0) => {
    setBusy(true);
    setError(undefined);
    try {
      const payment = await api<Payment>("/payments", {
        method: "POST",
        idempotencyKey: key,
        body: { payer_id: payerId, payee_id: payeeId, amount: cents, device_id: device, capture, description: "Dashboard test payment" },
      });
      setResult({ payment, key, replays });
      void refresh();
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const replay = async () => {
    if (!result) return;
    await send(result.key, result.replays + 1);
    toast("Same Idempotency-Key sent again: no second charge was created", "info");
  };

  return (
    <Modal
      title="New test payment"
      onClose={onClose}
      footer={
        result ? (
          <>
            <button className="btn" onClick={replay} disabled={busy}><Repeat size={15} /> Retry with same key</button>
            <button className="btn primary" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!valid || busy} onClick={() => send(newIdempotencyKey())}>
              <Send size={15} /> {busy ? "Sending…" : "Send payment"}
            </button>
          </>
        )
      }
    >
      {error && <div className="alert bad">{error}</div>}
      {result ? (
        <div className="stack">
          <div className="row between">
            <div>
              <div className="muted">{name(result.payment.payer_id)} → {name(result.payment.payee_id)}</div>
              <div style={{ fontSize: 24, fontWeight: 700 }} className="num">{money(result.payment.amount)}</div>
            </div>
            <PaymentStatus payment={result.payment} />
          </div>
          {result.payment.fraud && (
            <div className="alert info">
              Fraud score {result.payment.fraud.score.toFixed(2)} → {result.payment.fraud.decision}.
              {result.payment.fraud.reasons.length === 0 ? " No rules triggered." : ` ${result.payment.fraud.reasons.map((r) => r.detail).join("; ")}.`}
            </div>
          )}
          <dl className="kv">
            <dt>Payment id</dt><dd className="mono">{result.payment.id}</dd>
            <dt>Idempotency key</dt><dd className="mono">{result.key}</dd>
            <dt>Requests sent</dt><dd>{result.replays + 1} {result.replays > 0 && <Badge tone="ok">same payment returned each time</Badge>}</dd>
          </dl>
        </div>
      ) : (
        <>
          <label className="field">From (customer)
            <select className="input" value={payerId} onChange={(e) => setPayer(e.target.value)}>
              {customers.map((a) => <option key={a.id} value={a.id}>{a.name} · {money(a.balance)}</option>)}
            </select>
          </label>
          <label className="field">To (merchant)
            <select className="input" value={payeeId} onChange={(e) => setPayee(e.target.value)}>
              {merchants.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <div className="two-col">
            <label className="field">Amount (USD)
              <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="field">Device id <span className="hint">used by the new-device rule</span>
              <input className="input" value={device} onChange={(e) => setDevice(e.target.value)} />
            </label>
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={capture} onChange={(e) => setCapture(e.target.checked)} />
            Capture immediately <span className="muted">(untick to authorize only and capture later)</span>
          </label>
          {customers.length === 0 && <div className="alert info">Create a customer and a merchant account first (Accounts page).</div>}
        </>
      )}
    </Modal>
  );
}

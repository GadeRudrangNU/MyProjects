import { useState } from "react";
import { useAccounts } from "../accounts-context";
import { api, newIdempotencyKey } from "../api";
import { dateTime, money } from "../format";
import { usePolling } from "../hooks";
import type { LedgerTransaction, Page, Payment } from "../types";
import { Drawer, errorText, PaymentStatus, RiskMeter, useToast } from "./ui";

export function PaymentDrawer({ paymentId, onClose, onChanged }: { paymentId: string; onClose: () => void; onChanged: () => void }) {
  const { name, refresh: refreshAccounts } = useAccounts();
  const toast = useToast();
  const { data: payment, refresh } = usePolling(() => api<Payment>(`/payments/${paymentId}`), 3000, [paymentId]);
  const { data: ledger, refresh: refreshLedger } = usePolling(
    () => api<Page<LedgerTransaction>>("/transactions", { params: { reference: paymentId } }),
    0,
    [paymentId],
  );
  const [busy, setBusy] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");

  if (!payment) return <Drawer title="Payment" onClose={onClose}><div className="muted">Loading…</div></Drawer>;

  const remaining = payment.amount - payment.refunded_amount;
  const act = async (label: string, path: string, body?: unknown) => {
    setBusy(true);
    try {
      await api(path, { method: "POST", idempotencyKey: newIdempotencyKey(), body });
      toast(`${label} succeeded`);
      await Promise.all([refresh(), refreshLedger(), refreshAccounts()]);
      onChanged();
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  const cents = refundAmount ? Math.round(parseFloat(refundAmount) * 100) : remaining;

  return (
    <Drawer
      title={<span className="num">{money(payment.amount)}</span>}
      subtitle={<span>{name(payment.payer_id)} → {name(payment.payee_id)}</span>}
      onClose={onClose}
    >
      <div className="row between">
        <PaymentStatus payment={payment} />
        <span className="muted">{dateTime(payment.created_at)}</span>
      </div>

      <div>
        <div className="section-title">Details</div>
        <dl className="kv">
          <dt>Payment id</dt><dd className="mono">{payment.id}</dd>
          <dt>Description</dt><dd>{payment.description || <span className="muted">none</span>}</dd>
          <dt>Device</dt><dd>{payment.device_id || <span className="muted">none</span>}</dd>
          <dt>Refunded</dt><dd className="num">{money(payment.refunded_amount)} of {money(payment.amount)}</dd>
        </dl>
      </div>

      <div>
        <div className="section-title">Fraud assessment</div>
        {payment.fraud ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row">
              <RiskMeter score={payment.fraud.score} decision={payment.fraud.decision} />
              <b style={{ textTransform: "capitalize" }}>{payment.fraud.decision}</b>
              {payment.fraud.model_score !== null && <span className="muted">model probability {(payment.fraud.model_score * 100).toFixed(2)}%</span>}
              {payment.fraud.amount_zscore !== null && <span className="muted">· amount z-score {payment.fraud.amount_zscore.toFixed(1)}</span>}
            </div>
            {payment.fraud.reasons.length === 0 ? (
              <div className="muted">No rules triggered.</div>
            ) : (
              payment.fraud.reasons.map((r, i) => (
                <div className="reason" key={i}><b>{r.code.replace(/_/g, " ")}</b><span>{r.detail}</span></div>
              ))
            )}
          </div>
        ) : <div className="muted">Not assessed.</div>}
      </div>

      <div>
        <div className="section-title">Ledger entries</div>
        {ledger && ledger.results.length > 0 ? (
          ledger.results.map((t) => (
            <div key={t.id} style={{ marginBottom: 12 }}>
              <div className="row between"><b style={{ textTransform: "capitalize" }}>{t.kind}</b><span className="muted">{dateTime(t.created_at)}</span></div>
              {t.entries.map((e) => (
                <div className="entry" key={e.id}>
                  <span>{name(e.account_id)} <span className="muted">{e.amount < 0 ? "debit" : "credit"}</span></span>
                  <span className={`num ${e.amount < 0 ? "neg" : "pos"}`}>{money(e.amount, true)}</span>
                </div>
              ))}
            </div>
          ))
        ) : <div className="muted">No money has moved for this payment.</div>}
      </div>

      {(payment.status === "authorized" || payment.status === "captured") && (
        <div>
          <div className="section-title">Actions</div>
          {payment.status === "authorized" && (
            <div className="row">
              <button className="btn good" disabled={busy} onClick={() => act("Capture", `/payments/${payment.id}/capture`)}>Capture funds</button>
              <button className="btn danger" disabled={busy} onClick={() => act("Void", `/payments/${payment.id}/void`)}>Void authorization</button>
            </div>
          )}
          {payment.status === "captured" && remaining > 0 && (
            <div className="row">
              <input className="input num" style={{ width: 130 }} placeholder={(remaining / 100).toFixed(2)} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} aria-label="Refund amount in dollars" />
              <button className="btn danger" disabled={busy || !(cents > 0)} onClick={() => act("Refund", "/refunds", { payment_id: payment.id, amount: cents, reason: "Dashboard refund" })}>
                Refund {money(cents > 0 ? cents : 0)}
              </button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

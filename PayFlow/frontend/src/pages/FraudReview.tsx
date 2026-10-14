import { Check, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { useAccounts } from "../accounts-context";
import { api } from "../api";
import { Card, Empty, ErrorBanner, errorText, RiskMeter, useToast } from "../components/ui";
import { failureLabel, money, timeAgo } from "../format";
import { usePolling, useNow } from "../hooks";
import type { Page, Payment, ReviewItem } from "../types";

export function FraudReviewPage() {
  const [tab, setTab] = useState<"open" | "approved" | "rejected">("open");
  const queue = usePolling(() => api<Page<ReviewItem>>("/fraud/review-queue", { params: { status: tab, limit: 100 } }), 2500, [tab]);
  const { name, refresh: refreshAccounts } = useAccounts();
  const toast = useToast();
  const now = useNow(5000);
  const [busy, setBusy] = useState<string>();

  const resolve = async (item: ReviewItem, decision: "approve" | "reject") => {
    setBusy(item.payment.id);
    try {
      const result = await api<Payment>(`/fraud/review/${item.payment.id}/resolve`, { method: "POST", body: { decision } });
      if (decision === "reject") toast("Rejected. No money moved.", "info");
      else if (result.status === "failed") toast(`Approved, but the payment failed: ${failureLabel(result.failure_reason).toLowerCase()}.`, "bad");
      else toast("Approved. The payment has been processed.");
      await Promise.all([queue.refresh(), refreshAccounts()]);
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <div className="row between">
        <div className="tabs">
          {(["open", "approved", "rejected"] as const).map((t) => (
            <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)} style={{ textTransform: "capitalize" }}>{t}</button>
          ))}
        </div>
        <span className="muted">Payments scored 0.50+ are held here without moving money, riskiest first.</span>
      </div>
      <ErrorBanner error={queue.error} />
      <Card flush>
        {queue.data && queue.data.results.length > 0 ? queue.data.results.map((item) => {
          const p = item.payment;
          return (
            <div className="review" key={item.id}>
              <div className="stack" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 14 }}>
                  <h3 className="num">{money(p.amount)}</h3>
                  <span>{name(p.payer_id)} <span className="muted">→</span> {name(p.payee_id)}</span>
                  <span className="muted">{timeAgo(item.created_at, now)}</span>
                </div>
                <div className="row"><RiskMeter score={p.fraud_score} decision={p.fraud_decision} />
                  {p.fraud?.model_score != null && <span className="muted">model probability {(p.fraud.model_score * 100).toFixed(2)}%</span>}
                  {p.device_id && <span className="muted">· device {p.device_id}</span>}
                </div>
                {p.fraud?.reasons.map((r, i) => <div className="reason" key={i}><b>{r.code.replace(/_/g, " ")}</b><span>{r.detail}</span></div>)}
              </div>
              {tab === "open" ? (
                <div className="stack" style={{ gap: 8, justifyContent: "center" }}>
                  <button className="btn good" disabled={busy === p.id} onClick={() => resolve(item, "approve")}><Check size={16} /> Approve</button>
                  <button className="btn danger" disabled={busy === p.id} onClick={() => resolve(item, "reject")}><X size={16} /> Reject</button>
                </div>
              ) : <div className="muted" style={{ alignSelf: "center", textTransform: "capitalize" }}>{item.status}</div>}
            </div>
          );
        }) : (
          <Empty title={tab === "open" ? "Nothing to review" : `No ${tab} reviews`} icon={<ShieldAlert size={28} />}>
            {tab === "open" && "Suspicious payments will appear here. Try the traffic simulator to generate some."}
          </Empty>
        )}
      </Card>
    </>
  );
}

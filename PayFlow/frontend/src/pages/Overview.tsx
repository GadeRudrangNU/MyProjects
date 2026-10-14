import { Activity, AlertTriangle, BadgeDollarSign, CheckCircle2, ScanSearch, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { PaymentDrawer } from "../components/PaymentDrawer";
import { PaymentsTable } from "../components/PaymentsTable";
import { Card, Empty, ErrorBanner, Kpi, StatusBadge } from "../components/ui";
import { clock, compactMoney, percent } from "../format";
import { usePolling } from "../hooks";
import type { ModelInfo, Overview, Page, Payment } from "../types";

const BRAND = "#4f46e5";
const FLAG = "#f59e0b";

export function OverviewPage() {
  const overview = usePolling(() => api<Overview>("/stats/overview"), 2500);
  const recent = usePolling(() => api<Page<Payment>>("/payments", { params: { limit: 8 } }), 2500);
  const model = usePolling(() => api<ModelInfo>("/fraud/model"), 0);
  const [open, setOpen] = useState<string>();
  const o = overview.data;

  if (overview.error && !o) return <ErrorBanner error={overview.error} />;
  const series = (o?.series ?? []).map((p) => ({ ...p, label: clock(p.minute).slice(0, 5), dollars: p.volume / 100 }));
  const by = o?.payments.by_status ?? {};
  const recon = o?.reconciliation;

  return (
    <>
      <div className="kpis">
        <Kpi label="Payments, 24h" icon={<Activity size={15} />} value={o?.payments.total ?? "–"}
          note={o ? `${by.captured ?? 0} captured · ${by.failed ?? 0} failed · ${by.pending ?? 0} pending` : undefined} />
        <Kpi label="Captured volume" icon={<BadgeDollarSign size={15} />} value={o ? compactMoney(o.payments.captured_volume) : "–"}
          note={o ? `${compactMoney(o.payments.refunded_volume)} refunded` : undefined} />
        <Kpi label="Success rate" icon={<CheckCircle2 size={15} />} value={percent(o?.payments.success_rate)} note="authorized or captured" />
        <Kpi label="Flagged by fraud checks" icon={<ScanSearch size={15} />} value={percent(o?.payments.flag_rate)}
          note={o ? `${o.payments.flagged} payments · ${o.open_reviews} awaiting review` : undefined} />
        <Kpi label="Ledger reconciliation" icon={<ShieldCheck size={15} />}
          value={recon ? (recon.status === "ok" ? "Balanced" : "Mismatch") : "Not run"}
          note={recon ? (recon.status === "ok" ? "every balance matches its entries" : `${recon.mismatch_count} findings`) : "run it on the Reconciliation page"} />
      </div>

      <div className="chart-grid">
        <Card title="Payments per minute" sub="Last 30 minutes · flagged payments highlighted">
          <div style={{ height: 230 }}>
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={BRAND} stopOpacity={0.28} /><stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e4e7ef" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} interval={4} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e4e7ef", fontSize: 12.5 }} />
                <Area type="monotone" dataKey="count" name="Payments" stroke={BRAND} strokeWidth={2} fill="url(#g1)" />
                <Area type="monotone" dataKey="flagged" name="Flagged" stroke={FLAG} strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Captured volume per minute" sub="USD">
          <div style={{ height: 230 }}>
            <ResponsiveContainer>
              <BarChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#e4e7ef" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} interval={6} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, "Volume"]} contentStyle={{ borderRadius: 10, border: "1px solid #e4e7ef", fontSize: 12.5 }} />
                <Bar dataKey="dollars" fill={BRAND} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="chart-grid">
        <Card title="Live transactions" sub="Updates every few seconds · click a row for ledger entries and fraud reasons" flush>
          {recent.data && recent.data.results.length > 0 ? (
            <PaymentsTable payments={recent.data.results} onOpen={setOpen} />
          ) : (
            <Empty title="No payments yet">Send a test payment from the top bar, or run <span className="mono">scripts/simulate_traffic.py</span>.</Empty>
          )}
        </Card>
        <div className="stack">
          <Card title="Fraud model" sub={model.data && model.data.loaded ? `Logistic regression · held-out ${model.data.metrics.test_rows.toLocaleString()} real transactions` : "Logistic regression"}>
            {model.data && model.data.loaded ? (
              <>
                <div className="stat-line"><span className="muted">Flag (review or block)</span><span className="num"><b>{percent(model.data.metrics.review_or_block.recall, 0)}</b> recall · <b>{percent(model.data.metrics.review_or_block.precision, 0)}</b> precision</span></div>
                <div className="stat-line"><span className="muted">Block</span><span className="num"><b>{percent(model.data.metrics.block.recall, 0)}</b> recall · <b>{percent(model.data.metrics.block.precision, 0)}</b> precision</span></div>
                <div className="stat-line"><span className="muted">False-positive rate</span><span className="num"><b>{percent(model.data.metrics.review_or_block.false_positive_rate, 2)}</b> flagged · <b>{percent(model.data.metrics.block.false_positive_rate, 3)}</b> blocked</span></div>
                <div className="stat-line"><span className="muted">PR-AUC / ROC-AUC</span><span className="num"><b>{model.data.metrics.pr_auc.toFixed(2)}</b> / <b>{model.data.metrics.roc_auc.toFixed(3)}</b></span></div>
              </>
            ) : <div className="muted">Model not loaded; only rule-based checks run.</div>}
          </Card>
          <Card title="Webhook delivery" sub="Outbox status for your endpoint">
            <div className="stat-line"><span className="row"><StatusBadge status="delivered" /></span><b className="num">{o?.webhooks.delivered ?? 0}</b></div>
            <div className="stat-line"><span className="row"><StatusBadge status="pending" label="Pending / retrying" /></span><b className="num">{o?.webhooks.pending ?? 0}</b></div>
            <div className="stat-line"><span className="row"><StatusBadge status="dead" label="Gave up" /></span><b className="num">{o?.webhooks.dead ?? 0}</b></div>
          </Card>
          {recon?.status === "mismatch" && (
            <div className="alert bad"><AlertTriangle size={18} /> Reconciliation found {recon.mismatch_count} problems. Open the Reconciliation page.</div>
          )}
        </div>
      </div>
      {open && <PaymentDrawer paymentId={open} onClose={() => setOpen(undefined)} onChanged={() => { void overview.refresh(); void recent.refresh(); }} />}
    </>
  );
}

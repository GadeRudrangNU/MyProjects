import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { PaymentDrawer } from "../components/PaymentDrawer";
import { PaymentsTable } from "../components/PaymentsTable";
import { Card, Empty, ErrorBanner } from "../components/ui";
import { usePolling } from "../hooks";
import type { Page, Payment } from "../types";

const PAGE_SIZE = 25;

export function TransactionsPage() {
  const [status, setStatus] = useState("");
  const [decision, setDecision] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string>();
  const list = usePolling(
    () => api<Page<Payment>>("/payments", { params: { limit: PAGE_SIZE, offset, status, fraud_decision: decision } }),
    2500,
    [status, decision, offset],
  );
  const data = list.data;

  return (
    <>
      <ErrorBanner error={list.error} />
      <Card flush>
        <div className="toolbar">
          <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} aria-label="Filter by status">
            <option value="">All statuses</option>
            {["pending", "authorized", "captured", "refunded", "failed"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={decision} onChange={(e) => { setDecision(e.target.value); setOffset(0); }} aria-label="Filter by fraud decision">
            <option value="">Any fraud decision</option>
            {["approve", "review", "block"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="grow" />
          <span className="live"><span className="dot ok" /> Live</span>
          <span className="muted num">{data ? `${data.count.toLocaleString()} payments` : ""}</span>
        </div>
        {data && data.results.length > 0 ? (
          <PaymentsTable payments={data.results} onOpen={setOpen} />
        ) : (
          <Empty title={list.loading ? "Loading…" : "No payments match"}>Try clearing the filters.</Empty>
        )}
        {data && data.count > PAGE_SIZE && (
          <div className="toolbar" style={{ borderTop: "1px solid var(--line)", borderBottom: 0, justifyContent: "flex-end" }}>
            <span className="muted num">{offset + 1}–{Math.min(offset + PAGE_SIZE, data.count)} of {data.count}</span>
            <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label="Previous page"><ChevronLeft size={15} /></button>
            <button className="btn small" disabled={offset + PAGE_SIZE >= data.count} onClick={() => setOffset(offset + PAGE_SIZE)} aria-label="Next page"><ChevronRight size={15} /></button>
          </div>
        )}
      </Card>
      {open && <PaymentDrawer paymentId={open} onClose={() => setOpen(undefined)} onChanged={() => void list.refresh()} />}
    </>
  );
}

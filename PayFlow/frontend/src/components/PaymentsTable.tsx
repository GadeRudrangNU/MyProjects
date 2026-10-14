import { useEffect, useRef } from "react";
import { useAccounts } from "../accounts-context";
import { clock, money, shortId } from "../format";
import type { Payment } from "../types";
import { PaymentStatus, RiskMeter } from "./ui";

export function PaymentsTable({ payments, onOpen, compact }: { payments: Payment[]; onOpen: (id: string) => void; compact?: boolean }) {
  const { name } = useAccounts();
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current) for (const p of payments) if (!seen.current.has(p.id)) fresh.add(p.id);
  useEffect(() => {
    seen.current = new Set(payments.map((p) => p.id));
  }, [payments]);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th><th>Payment</th><th>Customer → Merchant</th><th className="right">Amount</th><th>Status</th>
            {!compact && <th>Risk</th>}
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className={`click ${fresh.has(p.id) ? "fresh" : ""}`} onClick={() => onOpen(p.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(p.id)}>
              <td className="muted num">{clock(p.created_at)}</td>
              <td className="mono">{shortId(p.id)}</td>
              <td>{name(p.payer_id)} <span className="muted">→</span> {name(p.payee_id)}</td>
              <td className="right num"><b>{money(p.amount)}</b></td>
              <td><PaymentStatus payment={p} /></td>
              {!compact && <td><RiskMeter score={p.fraud_score} decision={p.fraud_decision} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

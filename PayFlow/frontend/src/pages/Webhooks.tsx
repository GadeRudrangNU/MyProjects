import { Copy, Eye, EyeOff, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Drawer, Empty, ErrorBanner, errorText, StatusBadge, useToast } from "../components/ui";
import { dateTime, timeAgo } from "../format";
import { useNow, usePolling } from "../hooks";
import type { Page, WebhookDelivery, WebhookEndpoint } from "../types";

export function WebhooksPage() {
  const endpoint = usePolling(() => api<WebhookEndpoint>("/webhooks/endpoint"), 0);
  const [status, setStatus] = useState("");
  const deliveries = usePolling(() => api<Page<WebhookDelivery>>("/webhooks/deliveries", { params: { limit: 50, status } }), 2500, [status]);
  const toast = useToast();
  const now = useNow(1000);
  const [url, setUrl] = useState("");
  const [reveal, setReveal] = useState(false);
  const [open, setOpen] = useState<WebhookDelivery>();

  useEffect(() => { if (endpoint.data) setUrl(endpoint.data.url); }, [endpoint.data]);

  const save = async () => {
    try {
      await api("/webhooks/endpoint", { method: "PUT", body: { url } });
      toast("Webhook endpoint saved");
      await endpoint.refresh();
    } catch (e) { toast(errorText(e), "bad"); }
  };
  const retry = async (d: WebhookDelivery) => {
    try {
      await api(`/webhooks/deliveries/${d.id}/retry`, { method: "POST" });
      toast("Retry queued");
      await deliveries.refresh();
    } catch (e) { toast(errorText(e), "bad"); }
  };

  const secret = endpoint.data?.secret ?? "";
  return (
    <>
      <ErrorBanner error={endpoint.error ?? deliveries.error} />
      <div className="chart-grid">
        <Card title="Endpoint" sub="Events are POSTed here as JSON and signed so you can verify they came from PayFlow.">
          <div className="stack">
            <label className="field">URL
              <div className="row"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/payflow/webhooks" /><button className="btn primary" onClick={save}>Save</button></div>
            </label>
            <label className="field">Signing secret
              <div className="secret">
                <code className="mono">{reveal ? secret : "•".repeat(28)}</code>
                <button className="icon-btn" onClick={() => setReveal(!reveal)} aria-label={reveal ? "Hide secret" : "Show secret"}>{reveal ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                <button className="icon-btn" onClick={() => { void navigator.clipboard?.writeText(secret); toast("Secret copied"); }} aria-label="Copy secret"><Copy size={16} /></button>
              </div>
            </label>
          </div>
        </Card>
        <Card title="How delivery works">
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>Events are written in the same transaction as the payment change (outbox), so none are lost.</li>
            <li>Failures retry with exponential backoff and jitter, then give up after 8 attempts.</li>
            <li>Verify <span className="mono">PayFlow-Signature: t=…,v1=HMAC_SHA256(secret, "t." + body)</span> and reject old timestamps.</li>
          </ul>
        </Card>
      </div>

      <Card flush>
        <div className="toolbar">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter deliveries">
            <option value="">All deliveries</option><option value="pending">Pending / retrying</option><option value="delivered">Delivered</option><option value="dead">Gave up</option>
          </select>
          <span className="grow" /><span className="muted num">{deliveries.data?.count ?? 0} deliveries</span>
        </div>
        {deliveries.data && deliveries.data.results.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Event</th><th>Status</th><th className="right">Attempts</th><th>Last response</th><th>Next attempt</th><th>Created</th><th /></tr></thead>
              <tbody>
                {deliveries.data.results.map((d) => (
                  <tr key={d.id} className="click" onClick={() => setOpen(d)}>
                    <td className="mono">{d.event_type}</td>
                    <td><StatusBadge status={d.status} label={d.status === "pending" ? (d.attempts ? "Retrying" : "Queued") : d.status === "dead" ? "Gave up" : "Delivered"} /></td>
                    <td className="right num">{d.attempts}</td>
                    <td className="muted">{d.last_error || (d.last_status_code ? `HTTP ${d.last_status_code}` : "–")}</td>
                    <td className="muted">{d.next_attempt_at && d.status === "pending" ? (new Date(d.next_attempt_at).getTime() <= now ? "due" : `in ${Math.max(1, Math.round((new Date(d.next_attempt_at).getTime() - now) / 1000))}s`) : "–"}</td>
                    <td className="muted">{timeAgo(d.created_at, now)}</td>
                    <td className="right" onClick={(e) => e.stopPropagation()}>{d.status !== "delivered" && <button className="btn small" onClick={() => retry(d)}><RotateCw size={13} /> Retry</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No deliveries">Set an endpoint, then create a payment.</Empty>}
      </Card>
      {open && (
        <Drawer title={<span className="mono">{open.event_type}</span>} subtitle={dateTime(open.created_at)} onClose={() => setOpen(undefined)}>
          <pre className="mono" style={{ background: "var(--surface-2)", padding: 14, borderRadius: 10, overflow: "auto", margin: 0 }}>{JSON.stringify(open.payload, null, 2)}</pre>
        </Drawer>
      )}
    </>
  );
}

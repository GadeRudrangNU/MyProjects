import { useEffect, useState } from "react";
import { loadData, type Data } from "./api";
import Alerts from "./Alerts";
import Ask from "./Ask";
import { Bars } from "./Charts";
import type { Campaign } from "./types";

type Tab = "overview" | "alerts" | "backtest" | "ask";
const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["alerts", "Alerts"],
  ["backtest", "Backtest"],
  ["ask", "Ask"],
];
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const fmt = (v: number | null, suffix = "") => (v === null ? "n/a" : `${v}${suffix}`);

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat">
      <div className="statvalue">{value}</div>
      <div className="statlabel">{label}</div>
      <div className="muted small">{hint}</div>
    </div>
  );
}

function Overview({ data }: { data: Data }) {
  const m = data.metrics;
  return (
    <>
      <div className="stats">
        <Stat label="Recalls caught early" value={fmt(m.recall_pct_addressable, "%")} hint={`${m.detected_early_addressable} of ${m.campaigns_addressable} recalls that had a complaint trail (${m.detected_early} of all ${m.campaigns_total}, ${fmt(m.recall_pct_all, "%")})`} />
        <Stat label="Mean lead time" value={fmt(m.lead_weeks_mean, " wk")} hint={`median ${fmt(m.lead_weeks_median, " wk")} before the recall report`} />
        <Stat label="Alert precision" value={fmt(m.precision_pct, "%")} hint={`${m.alerts_hit} hit, ${m.alerts_miss} no recall, ${m.alerts_pending} pending`} />
        <Stat label="Summaries grounded" value={fmt(m.summaries.final_grounded_pct, "%")} hint={m.summaries.hallucination_rate_pct === null ? "extractive mode (no LLM)" : `LLM hallucination rate ${m.summaries.hallucination_rate_pct}%`} />
      </div>
      <div className="two">
        <section>
          <h3>Lead time before recall</h3>
          <Bars data={m.lead_histogram} />
        </section>
        <section>
          <h3>Threshold trade-off</h3>
          <table className="table compact">
            <thead>
              <tr><th>Min complaints / 90d</th><th className="num">Alerts</th><th className="num">Precision</th><th className="num">Recall*</th><th className="num">Lead (wk)</th></tr>
            </thead>
            <tbody>
              {m.sweep.map((r) => (
                <tr key={r.min_count} className={r.min_count === m.config.min_count ? "sel" : ""}>
                  <td>{r.min_count}</td>
                  <td className="num">{r.alerts_total}</td>
                  <td className="num">{fmt(r.precision_pct, "%")}</td>
                  <td className="num">{fmt(r.recall_pct_addressable, "%")}</td>
                  <td className="num">{fmt(r.lead_weeks_mean)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">*Recall over recalls that had a complaint trail. Lower thresholds find more recalls and earlier, at the cost of precision.</p>
        </section>
      </div>
    </>
  );
}

function Backtest({ data }: { data: Data }) {
  const [status, setStatus] = useState("");
  const rows: Campaign[] = data.campaigns.filter((c) => !status || c.status === status);
  return (
    <>
      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All recalls</option>
          <option value="early">Detected early</option>
          <option value="late">Detected late</option>
          <option value="missed">Missed</option>
        </select>
      </div>
      <table className="table">
        <thead>
          <tr><th>Recall report</th><th>Campaign</th><th>Vehicle</th><th>Component</th><th className="num">Complaints (prior 180d)</th><th>Result</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.camp_no + c.model}>
              <td>{c.report_date}</td>
              <td>{c.camp_no}</td>
              <td>{title(c.make)} {title(c.model)} <span className="muted">{c.years.join("/")}</span></td>
              <td>{title(c.component.split(/[:,]/)[0])}</td>
              <td className="num">{c.n_complaints_before}</td>
              <td>
                <span className={`pill ${c.status}`}>{c.status}</span>
                {c.lead_weeks !== null && <span className="muted"> {c.lead_weeks} wk before</span>}
                {!c.addressable && <span className="muted"> · no complaint trail</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function App() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  // deep links: #overview, #alerts, #alerts/12, #backtest
  const hashTab = (): Tab => (TABS.map(([k]) => k).find((k) => location.hash.slice(1).startsWith(k)) ?? "overview");
  const [tab, setTab] = useState<Tab>(hashTab);
  const pick = (k: Tab) => {
    location.hash = k;
    setTab(k);
  };

  useEffect(() => {
    loadData().then(setData, (e) => setErr(String(e)));
  }, []);

  return (
    <div className="app">
      <header>
        <h1>🚗 WroomCheck</h1>
        <p className="muted">Early vehicle-defect detection from NHTSA complaints, backtested against real recalls.</p>
        <nav>
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => pick(k)}>{label}</button>
          ))}
        </nav>
      </header>
      {err && <p className="callout miss">Could not load results: {err}. Run <code>wroomcheck demo</code> first.</p>}
      {!data && !err && <p className="muted">Loading…</p>}
      {data && (
        <main>
          {data.meta.mode === "synthetic" && (
            <div className="banner">
              Demo data: {data.meta.complaints.toLocaleString()} <b>synthetic</b> complaints for fictional makes with planted defects.
              Numbers show the method working, not real-world performance.
            </div>
          )}
          {data.meta.mode === "nhtsa" && (
            <div className="banner info">
              <b>Real NHTSA data:</b> {data.meta.complaints.toLocaleString()} owner complaints backtested against actual recalls.{" "}
              {data.meta.note?.replace("Real NHTSA complaints and recalls. ", "")}
            </div>
          )}
          {tab === "overview" && <Overview data={data} />}
          {tab === "alerts" && <Alerts data={data} />}
          {tab === "backtest" && <Backtest data={data} />}
          {tab === "ask" && <Ask data={data} />}
          <footer className="muted small">
            {data.live ? "Live API" : "Static snapshot"} · {data.meta.date_range[0]} to {data.meta.date_range[1]} · embedder {data.meta.embedder} · generated {data.meta.generated_at.slice(0, 10)}
          </footer>
        </main>
      )}
    </div>
  );
}

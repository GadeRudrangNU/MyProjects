import { Fragment, useEffect, useMemo, useState } from "react";
import type { Data } from "./api";
import { Timeline } from "./Charts";
import type { Alert, Outcome } from "./types";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  hit: "Recalled later",
  miss: "No recall",
  pending: "Pending",
  already_recalled: "Already recalled",
};

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Render [C123] citations as chips that jump to the evidence list. */
function Cited({ text, onPick }: { text: string; onPick: (id: number) => void }) {
  return (
    <>
      {text.split(/(\[C\d+\])/g).map((part, i) => {
        const m = part.match(/^\[C(\d+)\]$/);
        return m ? (
          <button key={i} className="cite" onClick={() => onPick(Number(m[1]))} title={`Complaint ${m[1]}`}>
            {m[1].slice(-4)}
          </button>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}

function Detail({ id, data }: { id: number; data: Data }) {
  const [a, setA] = useState<Alert | null>(null);
  const [hl, setHl] = useState<number | null>(null);
  useEffect(() => {
    setA(null);
    data.detail(id).then(setA);
  }, [id, data]);
  if (!a) return <div className="detail muted">Loading…</div>;
  const lead = a.lead_weeks !== null && a.campaign;
  return (
    <div className="detail">
      <h3>
        {title(a.make)} {title(a.model)} {a.years.join("/")} · {title(a.component)}
      </h3>
      <p className="muted">
        First complaint {a.first_date} · alert raised <b>{a.alert_date}</b> · {a.n_window} complaints in the 90 days before
        {a.severe_window > 0 && <> · {a.severe_window} crash/fire/injury</>} · keywords: {a.keywords.join(", ")}
      </p>
      {a.campaign ? (
        <div className={`callout ${a.outcome}`}>
          {a.outcome === "hit" && lead && (
            <>
              <b>{a.lead_weeks} weeks early.</b>{" "}
            </>
          )}
          Matching recall {a.campaign.camp_no} reported to NHTSA on {a.campaign.report_date}.
        </div>
      ) : (
        <div className={`callout ${a.outcome}`}>
          {a.outcome === "pending" ? "Too recent to know whether a recall follows." : "No matching recall within 18 months of this alert."}
        </div>
      )}
      {a.timeline && <Timeline data={a.timeline} alertDate={a.alert_date} recallDate={a.campaign?.report_date} />}
      <h4>
        Summary <span className={`pill ${a.summary.grounded ? "ok" : "bad"}`}>{a.summary.grounded ? "grounded" : "unverified"}</span>{" "}
        <span className="pill">{a.summary.mode}</span>
      </h4>
      <p className="summary">
        <Cited text={a.summary.text} onPick={setHl} />
      </p>
      <h4>Evidence ({a.evidence?.length ?? 0} complaints)</h4>
      <ul className="evidence">
        {a.evidence?.map((e) => (
          <li key={e.id} className={hl === e.id ? "hl" : ""} ref={(el) => hl === e.id && el?.scrollIntoView({ block: "nearest" })}>
            <span className="muted">
              C{e.id} · {e.date} · MY{e.year}
            </span>
            {e.severe && <span className="pill bad">crash/fire/injury</span>}
            <div>{e.text}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Alerts({ data }: { data: Data }) {
  const [make, setMake] = useState("");
  const [component, setComponent] = useState("");
  const [outcome, setOutcome] = useState("");
  const fromHash = Number(location.hash.match(/^#alerts\/(\d+)/)?.[1]);
  const [sel, setSel] = useState<number | null>(fromHash || (data.alerts[0]?.id ?? null));

  const components = useMemo(() => [...new Set(data.alerts.map((a) => a.component))].sort(), [data]);
  const rows = data.alerts.filter(
    (a) => (!make || a.make === make) && (!component || a.component === component) && (!outcome || a.outcome === outcome),
  );

  return (
    <div className="split">
      <div>
        <div className="filters">
          <select value={make} onChange={(e) => setMake(e.target.value)} aria-label="Make">
            <option value="">All makes</option>
            {data.meta.makes.map((m) => (
              <option key={m} value={m}>{title(m)}</option>
            ))}
          </select>
          <select value={component} onChange={(e) => setComponent(e.target.value)} aria-label="Component">
            <option value="">All components</option>
            {components.map((c) => (
              <option key={c} value={c}>{title(c)}</option>
            ))}
          </select>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
            <option value="">Any outcome</option>
            {Object.entries(OUTCOME_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Alert date</th>
              <th>Vehicle</th>
              <th>Component</th>
              <th className="num">Complaints</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={sel === a.id ? "sel" : ""} onClick={() => setSel(a.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(a.id)}>
                <td>{a.alert_date}</td>
                <td>
                  {title(a.make)} {title(a.model)} <span className="muted">{a.years.join("/")}</span>
                </td>
                <td>{title(a.component)}</td>
                <td className="num">{a.n_window}</td>
                <td>
                  <span className={`pill ${a.outcome}`}>{OUTCOME_LABEL[a.outcome]}</span>
                  {a.lead_weeks !== null && <span className="muted"> {a.lead_weeks}w early</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="muted">No alerts match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {sel !== null && <Detail id={sel} data={data} />}
    </div>
  );
}

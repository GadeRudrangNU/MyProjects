import { useQuery } from "@tanstack/react-query";
import { api, type Flag } from "../api";
import { formatPValue, percent, verdictLabel } from "../format";
import { ErrorRateChart } from "./ErrorRateChart";

export function HealthPanel({ flag }: { flag: Flag }) {
  const { data } = useQuery({
    queryKey: ["metrics", flag.key],
    queryFn: () => api.metrics(flag.key),
    refetchInterval: 1000,
  });

  if (!data) {
    return (
      <section className="card">
        <h2>Release health</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const { assessment: a, series } = data;
  const verdict = flag.enabled ? a.verdict : "disabled";
  const target = flag.guard.minSamples;

  return (
    <section className="card" data-testid="health-panel">
      <div className="card-head">
        <h2>Release health</h2>
        <span className={`verdict ${verdict}`} data-testid="verdict">
          {flag.enabled ? verdictLabel[a.verdict] : "Flag is off"}
        </span>
      </div>

      <div className="stats">
        <div className="stat on">
          <span className="label">New version</span>
          <strong data-testid="rate-on">{percent(a.treatment.rate)}</strong>
          <span className="muted small">
            {a.treatment.errors} errors / {a.treatment.requests} requests
          </span>
        </div>
        <div className="stat off">
          <span className="label">Old version</span>
          <strong data-testid="rate-off">{percent(a.control.rate)}</strong>
          <span className="muted small">
            {a.control.errors} errors / {a.control.requests} requests
          </span>
        </div>
      </div>

      {flag.enabled && a.verdict === "insufficientData" && (
        <p className="muted small">
          Needs {target} requests on each version before judging. Now {a.treatment.requests} new, {a.control.requests} old.
        </p>
      )}
      {flag.enabled && (a.verdict === "healthy" || a.verdict === "regressed") && (
        <p className="muted small">
          Difference {percent(a.difference)} · z = {a.z.toFixed(2)} · p = {formatPValue(a.pValue)} (limit {flag.guard.alpha})
        </p>
      )}

      <ErrorRateChart series={series} />
    </section>
  );
}

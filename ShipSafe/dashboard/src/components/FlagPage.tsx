import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { AuditList } from "./AuditList";
import { FlagEditor } from "./FlagEditor";
import { HealthPanel } from "./HealthPanel";

export function FlagPage({ flagKey }: { flagKey: string }) {
  if (flagKey === "new") {
    return (
      <>
        <a className="back" href="#/">‹ All flags</a>
        <div className="page-head">
          <h1>New flag</h1>
        </div>
        <FlagEditor />
      </>
    );
  }

  return <ExistingFlag flagKey={flagKey} />;
}

function ExistingFlag({ flagKey }: { flagKey: string }) {
  const { data: flag, error, isLoading } = useQuery({
    queryKey: ["flag", flagKey],
    queryFn: async () => (await api.flags()).find((f) => f.key === flagKey) ?? null,
    refetchInterval: 1500,
  });

  const audit = useQuery({
    queryKey: ["audit", flagKey],
    queryFn: () => api.audit(flagKey),
    refetchInterval: 2000,
  });

  if (isLoading) {
    return <p className="muted">Loading…</p>;
  }

  if (error) {
    return <p role="alert" className="error">Could not load flag: {error.message}</p>;
  }

  if (!flag) {
    return (
      <>
        <a className="back" href="#/">‹ All flags</a>
        <p role="alert">Flag “{flagKey}” does not exist.</p>
      </>
    );
  }

  return (
    <>
      <a className="back" href="#/">‹ All flags</a>
      <div className="page-head">
        <div>
          <h1>{flag.key}</h1>
          <p className="muted">Version {flag.version}</p>
        </div>
      </div>
      <div className="columns">
        <div>
          <FlagEditor key={flag.key} flag={flag} />
        </div>
        <div className="stack">
          <HealthPanel flag={flag} />
          <section className="card">
            <h2>Activity</h2>
            <AuditList rows={audit.data ?? []} showFlag={false} />
          </section>
        </div>
      </div>
    </>
  );
}

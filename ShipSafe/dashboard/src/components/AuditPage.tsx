import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { AuditList } from "./AuditList";

export function AuditPage() {
  const { data, error } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api.audit(),
    refetchInterval: 2000,
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Every change to a flag, who made it and when.</p>
        </div>
      </div>
      {error && <p role="alert" className="error">Could not load the audit log: {error.message}</p>}
      <section className="card">
        <AuditList rows={data ?? []} showFlag />
      </section>
    </>
  );
}

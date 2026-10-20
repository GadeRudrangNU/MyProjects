import type { AuditRow } from "../api";
import { actionLabel, formatTime } from "../format";

export function AuditList({ rows, showFlag }: { rows: AuditRow[]; showFlag: boolean }) {
  if (rows.length === 0) {
    return <p className="muted">Nothing recorded yet.</p>;
  }

  return (
    <ol className="audit" data-testid="audit-list">
      {rows.map((row) => (
        <li key={row.id} className={row.action.startsWith("rollback") ? "rollback" : ""}>
          <div className="audit-head">
            <span className="action">{actionLabel[row.action] ?? row.action}</span>
            {showFlag && (
              <a href={`#/flags/${encodeURIComponent(row.flagKey)}`} className="flag-key">
                {row.flagKey}
              </a>
            )}
            <time dateTime={row.at}>{formatTime(row.at)}</time>
          </div>
          <p>{row.summary}</p>
          <span className="muted small">by {row.actor}</span>
        </li>
      ))}
    </ol>
  );
}

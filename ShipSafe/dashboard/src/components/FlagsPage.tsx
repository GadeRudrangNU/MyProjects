import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, toInput, type Flag } from "../api";
import { navigate } from "../useHash";
import { Switch } from "./Switch";

export function FlagsPage() {
  const client = useQueryClient();
  const { data: flags, error, isLoading } = useQuery({
    queryKey: ["flags"],
    queryFn: api.flags,
    refetchInterval: 1500,
  });

  const toggle = useMutation({
    mutationFn: (flag: Flag) => api.updateFlag({ ...toInput(flag), enabled: !flag.enabled }),
    onSuccess: () => client.invalidateQueries(),
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Flags</h1>
          <p className="muted">Switch features on gradually and let ShipSafe turn them off if they misbehave.</p>
        </div>
        <button className="primary" onClick={() => navigate("/flags/new")}>
          New flag
        </button>
      </div>

      {error && <p role="alert" className="error">Could not load flags: {error.message}</p>}
      {isLoading && <p className="muted">Loading flags…</p>}

      {flags && flags.length === 0 && (
        <div className="empty">
          <p>No flags yet.</p>
          <button className="primary" onClick={() => navigate("/flags/new")}>Create your first flag</button>
        </div>
      )}

      {flags && flags.length > 0 && (
        <table className="flags">
          <thead>
            <tr>
              <th scope="col">Flag</th>
              <th scope="col">On</th>
              <th scope="col">Rollout</th>
              <th scope="col">Rules</th>
              <th scope="col">Rollback</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.key} data-testid={`flag-row-${flag.key}`} onClick={() => navigate(`/flags/${encodeURIComponent(flag.key)}`)}>
                <td>
                  <a href={`#/flags/${encodeURIComponent(flag.key)}`} className="flag-key" onClick={(e) => e.stopPropagation()}>
                    {flag.key}
                  </a>
                  <div className="muted small">{flag.description}</div>
                </td>
                <td>
                  <Switch
                    checked={flag.enabled}
                    label={`Toggle ${flag.key}`}
                    disabled={toggle.isPending}
                    onChange={() => toggle.mutate(flag)}
                  />
                </td>
                <td>
                  <div className="rollout">
                    <div className="bar" aria-hidden="true">
                      <span style={{ width: `${flag.rolloutPercent}%` }} className={flag.enabled ? "" : "off"} />
                    </div>
                    <span>{flag.rolloutPercent}%</span>
                  </div>
                </td>
                <td>
                  {flag.conditions.length === 0 ? (
                    <span className="muted">Everyone</span>
                  ) : (
                    flag.conditions.map((c, i) => (
                      <span key={i} className="chip">
                        {c.attribute} {c.operator === "in" ? "in" : "not in"} {c.values.join(", ")}
                      </span>
                    ))
                  )}
                </td>
                <td>
                  <span className={`badge ${flag.guard.enabled ? "" : "muted-badge"}`}>
                    {!flag.guard.enabled ? "Off" : flag.guard.mode === "auto" ? "Automatic" : "Needs approval"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

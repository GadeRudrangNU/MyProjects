import type { Collab, ConnStatus } from '../collab/useCollab';

const LABEL: Record<ConnStatus, { text: string; dot: string }> = {
  connected: { text: 'Connected', dot: 'bg-ok' },
  connecting: { text: 'Connecting…', dot: 'bg-muted' },
  reconnecting: { text: 'Reconnecting… your changes are saved locally', dot: 'bg-accent-bg' },
  offline: { text: 'Offline. Changes are saved locally and will merge when you reconnect', dot: 'bg-danger' },
  denied: { text: 'You no longer have access to this file', dot: 'bg-danger' },
};

/** Fixed height so presence and status updates never shift the layout. */
export function StatusBar({ collab, readOnly, path }: { collab: Collab | null; readOnly: boolean; path: string }) {
  const status = collab?.status ?? 'connecting';
  const { text, dot } = LABEL[status];
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-2 px-3 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span role="status" className="truncate">{text}</span>
        {readOnly && (
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-medium">Read-only</span>
        )}
        <span className="sr-only">{path}</span>
      </div>
      <ul className="flex shrink-0 items-center -space-x-1" aria-label="Collaborators online">
        {collab?.peers.slice(0, 6).map((p) => (
          <li
            key={p.userId}
            title={p.name}
            className="grid size-6 place-items-center rounded-full border-2 border-surface-2 text-[11px] font-bold text-[#111]"
            style={{ background: p.color }}
          >
            <span aria-hidden>{p.name.slice(0, 1).toUpperCase()}</span>
            <span className="sr-only">{p.name} is online</span>
          </li>
        ))}
        {collab && collab.peers.length > 6 && (
          <li className="pl-2 text-muted">+{collab.peers.length - 6}</li>
        )}
      </ul>
      <p aria-live="polite" className="sr-only">{collab?.announcement}</p>
    </div>
  );
}

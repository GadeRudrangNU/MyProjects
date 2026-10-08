import type { KeyboardEvent } from 'react';
import type { FileNode } from '@quack/shared';

interface Props {
  files: FileNode[];
  open: string[];
  active: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

export function EditorTabs({ files, open, active, onActivate, onClose }: Props) {
  const byId = new Map(files.map((f) => [f.id, f]));
  const tabs = open.map((id) => byId.get(id)).filter((f): f is FileNode => !!f);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === active);
    const go = (n: number) => {
      const t = tabs[(n + tabs.length) % tabs.length];
      if (t) {
        onActivate(t.id);
        requestAnimationFrame(() => document.getElementById(`tab-${t.id}`)?.focus());
      }
    };
    if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(tabs.length - 1);
    else if (e.key === 'Delete' && active) {
      // Keyboard equivalent of the × affordance: the tab list may only contain tabs.
      const next = tabs[Math.min(i, tabs.length - 2)];
      onClose(active);
      if (next && next.id !== active) requestAnimationFrame(() => document.getElementById(`tab-${next.id}`)?.focus());
    }
    else return;
    e.preventDefault();
  };

  if (tabs.length === 0) return <div className="h-9 border-b border-border bg-surface-2" />;
  return (
    <div role="tablist" aria-label="Open files" onKeyDown={onKeyDown} className="flex h-9 shrink-0 overflow-x-auto border-b border-border bg-surface-2">
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            aria-selected={selected}
            aria-controls="editor-panel"
            tabIndex={selected ? 0 : -1}
            title={`${t.path} (Delete closes)`}
            onClick={() => onActivate(t.id)}
            className={`flex shrink-0 items-center gap-2 border-r border-border px-3 py-1.5 text-sm ${selected ? 'bg-surface font-semibold' : ''}`}
          >
            {t.path.split('/').pop()}
            <span
              aria-hidden
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              className="rounded px-1 text-muted hover:bg-border"
            >
              ×
            </span>
          </button>
        );
      })}
    </div>
  );
}

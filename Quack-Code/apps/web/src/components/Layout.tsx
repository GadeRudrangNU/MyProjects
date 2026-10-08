import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@quack/shared';
import { api } from '../lib/api';
import { Button, Modal } from './ui';

const SHORTCUTS: [string, string][] = [
  ['?', 'Show this help'],
  ['Ctrl/⌘ + Z', 'Undo your own edits (never a collaborator’s)'],
  ['Ctrl/⌘ + Shift + Z', 'Redo'],
  ['Ctrl/⌘ + Enter', 'Run the open JavaScript or Python file'],
  ['Esc, then Tab', 'Leave the editor (Tab otherwise indents)'],
  ['↑ ↓', 'Move through the file tree and tabs'],
  ['→ / ←', 'Expand / collapse a folder'],
  ['Enter', 'Open the focused file'],
  ['Delete (on a tab)', 'Close the tab'],
  ['F2', 'Rename the focused file or folder'],
  ['Delete', 'Delete the focused file or folder'],
];

export function Layout({ user, children }: { user: User; children: ReactNode }) {
  const [help, setHelp] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '?' && !t.closest('input, textarea, [contenteditable="true"], .cm-editor')) {
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const logout = async () => {
    await api('POST', '/auth/logout');
    qc.clear();
    nav('/login');
  };

  return (
    <div className="flex h-full flex-col">
      <a href="#main" className="sr-only-focusable rounded bg-accent-bg px-3 py-2 text-accent-text">
        Skip to content
      </a>
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span aria-hidden>🦆</span> Quack-Code
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts">
            Shortcuts
          </Button>
          <span className="hidden text-sm text-muted sm:inline">{user.name}</span>
          <Button onClick={logout}>Sign out</Button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-auto">
        {children}
      </main>
      <Modal open={help} onOpenChange={setHelp} title="Keyboard shortcuts">
        <dl className="space-y-2 text-sm">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt>
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
              </dt>
              <dd className="text-right text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </div>
  );
}

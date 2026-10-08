import { useEffect, useRef, useState } from 'react';
import type { Language } from '../sandbox/runner';
import type { RunnerState } from '../sandbox/useCodeRunner';
import { Button } from './ui';

const LEVEL_STYLE: Record<string, string> = {
  log: '',
  info: '',
  debug: 'text-muted',
  warn: 'text-accent',
  error: 'text-danger',
  system: 'text-muted italic',
};
// Level is also spelled out, so meaning never depends on colour alone.
const LEVEL_LABEL: Record<string, string> = { warn: 'warn', error: 'error' };

const NAMES: Record<Language, string> = { js: 'JavaScript', py: 'Python' };

interface Props {
  language: Language | null;
  state: RunnerState;
  onRun: () => void;
  onStop: () => void;
  onClear: () => void;
}

export function ConsolePanel({ language, state, onRun, onStop, onClear }: Props) {
  const [open, setOpen] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [state.lines]);

  const empty = state.lines.length === 0;
  return (
    <section aria-label="Console" className={`flex shrink-0 flex-col border-t border-border bg-surface ${open ? 'h-56' : 'h-10'}`}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-3">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="console-output"
          className="text-sm font-semibold"
        >
          {open ? '▾' : '▸'} Console
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{state.summary}</span>
        {state.running ? (
          <Button onClick={onStop} variant="danger" className="!py-1">Stop</Button>
        ) : (
          <Button
            onClick={() => {
              setOpen(true);
              onRun();
            }}
            variant="primary"
            disabled={!language}
            title={language ? `Run ${NAMES[language]} (Ctrl/⌘+Enter)` : 'Only JavaScript (.js) and Python (.py) files can run'}
            className="!py-1"
          >
            ▶ Run
          </Button>
        )}
        <Button onClick={onClear} variant="ghost" disabled={state.running || empty} className="!py-1">Clear</Button>
      </div>
      {open && (
        <div
          id="console-output"
          ref={scroller}
          role="log"
          aria-label="Console output"
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[13px] leading-relaxed"
        >
          {empty && (
            <p className="font-sans text-sm text-muted">
              {language
                ? `Run ${NAMES[language]} with the button or Ctrl/⌘+Enter. Code runs in your browser, in an isolated sandbox, and stops after 10 seconds.`
                : 'This file type cannot be run. JavaScript (.js) and Python (.py) files can.'}
            </p>
          )}
          {state.lines.map((l) => (
            <div key={l.id} className={`whitespace-pre-wrap break-words ${LEVEL_STYLE[l.level]}`}>
              {LEVEL_LABEL[l.level] && <span className="mr-2 rounded border border-current px-1 text-[11px] uppercase">{LEVEL_LABEL[l.level]}</span>}
              {l.text}
            </div>
          ))}
        </div>
      )}
      <p aria-live="polite" role="status" className="sr-only">{state.announcement}</p>
    </section>
  );
}

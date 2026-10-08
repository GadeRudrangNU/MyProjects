import { useCallback, useEffect, useRef, useState } from 'react';
import { SandboxRunner, type Language, type LogLevel, type RunStatus } from './runner';

export interface ConsoleLine {
  id: number;
  level: LogLevel | 'system';
  text: string;
}

export interface RunnerState {
  running: boolean;
  lines: ConsoleLine[];
  summary: string;
  /** Announced to screen readers when a run ends. */
  announcement: string;
}

export const TIMEOUT_MS = 10_000;
const IDLE: RunnerState = { running: false, lines: [], summary: '', announcement: '' };

function describe(status: RunStatus, ms: number, hadError: boolean): string {
  switch (status) {
    case 'ok': return `Finished in ${ms} ms`;
    case 'error': return hadError ? 'Failed with an error' : 'Failed';
    case 'timeout': return `Stopped: took longer than ${TIMEOUT_MS / 1000} seconds`;
    case 'limit': return 'Stopped: too much output';
    case 'stopped': return 'Stopped';
  }
}

export function useCodeRunner(language: Language | null) {
  const [state, setState] = useState<RunnerState>(IDLE);
  const runners = useRef<Partial<Record<Language, SandboxRunner>>>({});
  const lineId = useRef(0);
  const buffer = useRef<ConsoleLine[]>([]);
  const raf = useRef<number | null>(null);

  const flush = useCallback(() => {
    raf.current = null;
    const batch = buffer.current;
    if (!batch.length) return;
    buffer.current = [];
    setState((s) => ({ ...s, lines: [...s.lines, ...batch] }));
  }, []);
  const push = useCallback(
    (level: ConsoleLine['level'], text: string) => {
      buffer.current.push({ id: lineId.current++, level, text });
      if (raf.current === null) raf.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      Object.values(runners.current).forEach((r) => r?.dispose());
      runners.current = {};
    },
    [],
  );

  const run = useCallback(
    async (code: string) => {
      if (!language) return;
      const runner = (runners.current[language] ??= new SandboxRunner(language));
      buffer.current = [];
      setState({ running: true, lines: [], summary: 'Running…', announcement: '' });
      let hadError = false;
      const result = await runner.run(
        code,
        {
          onLog: (level, text) => push(level, text),
          onError: (message) => {
            hadError = true;
            push('error', message);
          },
          onStatus: (text) => push('system', text),
        },
        TIMEOUT_MS,
      );
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      const pending = buffer.current;
      buffer.current = [];
      raf.current = null;
      const summary = describe(result.status, result.ms, hadError);
      setState((s) => ({ running: false, lines: [...s.lines, ...pending], summary, announcement: `Run finished. ${summary}` }));
    },
    [language, push],
  );

  const stop = useCallback(() => {
    if (language) runners.current[language]?.stop();
  }, [language]);
  const clear = useCallback(() => setState((s) => (s.running ? s : IDLE)), []);

  return { state, run, stop, clear };
}

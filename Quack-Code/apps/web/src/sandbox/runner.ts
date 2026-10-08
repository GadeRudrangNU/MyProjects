export type Language = 'js' | 'py';
export type RunStatus = 'ok' | 'error' | 'timeout' | 'stopped' | 'limit';
export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface RunHandlers {
  onLog: (level: LogLevel, text: string) => void;
  onError: (message: string) => void;
  onStatus: (text: string) => void;
}
export interface RunResult {
  status: RunStatus;
  ms: number;
}

type FromSandbox =
  | { type: 'ready' }
  | { type: 'log'; id: number; level: LogLevel; text: string }
  | { type: 'error'; id: number; message: string; stack: string }
  | { type: 'status'; id: number; text: string }
  | { type: 'done'; id: number; status: RunStatus; ms: number };

const LANGUAGE_BY_EXT: Record<string, Language> = { js: 'js', mjs: 'js', cjs: 'js', py: 'py' };
export function languageOf(path: string): Language | null {
  return LANGUAGE_BY_EXT[path.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

let nextId = 1;

/**
 * Talks to one sandboxed iframe (opaque origin, scripts only). Code and output cross the boundary
 * exclusively through postMessage. If the iframe itself stops answering, it is thrown away and rebuilt.
 */
export class SandboxRunner {
  private frame: HTMLIFrameElement | null = null;
  private ready: Promise<void> | null = null;
  private active: { id: number; handlers: RunHandlers; finish: (r: RunResult) => void } | null = null;
  private onMessage = (ev: MessageEvent) => this.handle(ev);

  constructor(private language: Language) {
    window.addEventListener('message', this.onMessage);
  }

  private ensureFrame(): Promise<void> {
    if (this.ready) return this.ready;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts'); // deliberately no allow-same-origin
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    frame.src = `/sandbox/${this.language}.html`;
    this.frame = frame;
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The sandbox did not start')), 10_000);
      const onReady = (ev: MessageEvent) => {
        if (ev.source !== frame.contentWindow) return;
        const m = ev.data as FromSandbox | { type: 'fatal'; message: string };
        if (m?.type === 'ready') {
          clearTimeout(timeout);
          window.removeEventListener('message', onReady);
          resolve();
        } else if (m?.type === 'fatal') {
          clearTimeout(timeout);
          window.removeEventListener('message', onReady);
          reject(new Error(`The sandbox failed to start: ${m.message}`));
        }
      };
      window.addEventListener('message', onReady);
    });
    document.body.appendChild(frame);
    return this.ready;
  }

  private handle(ev: MessageEvent) {
    // The sandbox has an opaque origin, so the only trustworthy check is which window sent it.
    if (!this.frame || ev.source !== this.frame.contentWindow) return;
    const m = ev.data as FromSandbox;
    const a = this.active;
    if (!a || !m || (m as { id?: number }).id !== a.id) return;
    switch (m.type) {
      case 'log': a.handlers.onLog(m.level, m.text); break;
      case 'error': a.handlers.onError(m.message); break;
      case 'status': a.handlers.onStatus(m.text); break;
      case 'done': a.finish({ status: m.status, ms: m.ms }); break;
    }
  }

  async run(code: string, handlers: RunHandlers, timeoutMs = 10_000): Promise<RunResult> {
    if (this.active) this.stop();
    try {
      await this.ensureFrame();
    } catch (e) {
      this.reset();
      handlers.onError((e as Error).message);
      return { status: 'error', ms: 0 };
    }
    const id = nextId++;
    return new Promise<RunResult>((resolve) => {
      const finish = (r: RunResult) => {
        clearTimeout(backstop);
        if (this.active?.id === id) this.active = null;
        resolve(r);
      };
      // The sandbox enforces the timeout itself; this catches a sandbox that is no longer responding.
      // Python may spend a long time downloading its runtime before the clock starts, so allow for it.
      const backstop = setTimeout(() => {
        this.reset();
        finish({ status: 'timeout', ms: timeoutMs });
      }, timeoutMs + (this.language === 'py' ? 100_000 : 5_000));
      this.active = { id, handlers, finish };
      this.frame?.contentWindow?.postMessage({ type: 'run', id, code, timeoutMs }, '*');
    });
  }

  stop() {
    if (!this.active) return;
    this.frame?.contentWindow?.postMessage({ type: 'stop' }, '*');
  }

  private reset() {
    this.frame?.remove();
    this.frame = null;
    this.ready = null;
  }

  dispose() {
    window.removeEventListener('message', this.onMessage);
    this.active?.finish({ status: 'stopped', ms: 0 });
    this.reset();
  }
}

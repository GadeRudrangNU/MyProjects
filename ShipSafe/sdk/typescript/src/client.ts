import { evaluateFlag } from "./evaluate.js";
import type { Decision, FlagDefinition, FlagSnapshot, User } from "./types.js";

export interface ClientOptions {
  baseUrl: string;
  sdkKey: string;
  flushIntervalMs?: number;
  startTimeoutMs?: number;
  maxReconnectDelayMs?: number;
  idleTimeoutMs?: number;
  fetch?: typeof fetch;
  onError?: (error: unknown) => void;
}

interface Counter {
  flagKey: string;
  variant: boolean;
  requests: number;
  errors: number;
}

type Listener = (snapshot: FlagSnapshot) => void;

export class ShipSafeClient {
  private readonly baseUrl: string;
  private readonly sdkKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly flushIntervalMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly idleTimeoutMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly stop = new AbortController();
  private readonly counters = new Map<string, Counter>();
  private readonly listeners = new Set<Listener>();
  private flags = new Map<string, FlagDefinition>();
  private currentRevision = -1;
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private streamLoop: Promise<void> = Promise.resolve();
  private resolveReady: () => void = () => {};
  private readonly readyPromise = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });
  private isReady = false;

  private constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.sdkKey = options.sdkKey;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.flushIntervalMs = options.flushIntervalMs ?? 500;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 10_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 45_000;
    this.onError = options.onError ?? (() => {});
  }

  static async create(options: ClientOptions): Promise<ShipSafeClient> {
    const client = new ShipSafeClient(options);
    client.start();
    const timeoutMs = options.startTimeoutMs ?? 5000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      client.readyPromise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    return client;
  }

  get ready(): boolean {
    return this.isReady;
  }

  get revision(): number {
    return this.currentRevision;
  }

  getFlag(flagKey: string): FlagDefinition | undefined {
    return this.flags.get(flagKey);
  }

  evaluate(flagKey: string, user: User): Decision {
    const flag = this.flags.get(flagKey);
    return flag ? evaluateFlag(flag, user) : { flagKey, enabled: false, reason: "flagNotFound" };
  }

  isEnabled(flagKey: string, user: User): boolean {
    return this.evaluate(flagKey, user).enabled;
  }

  track(decision: Decision, success: boolean): void {
    if (decision.reason === "flagNotFound") {
      return;
    }
    const counter = this.counterFor(decision.flagKey, decision.enabled);
    counter.requests += 1;
    if (!success) {
      counter.errors += 1;
    }
  }

  onUpdate(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async flush(): Promise<void> {
    if (this.counters.size === 0) {
      return;
    }
    const reports = [...this.counters.values()];
    this.counters.clear();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/sdk/events`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sdk-key": this.sdkKey },
        body: JSON.stringify({ reports }),
      });
      if (!response.ok) {
        throw new Error(`Report failed with status ${response.status}`);
      }
    } catch (error) {
      for (const report of reports) {
        const counter = this.counterFor(report.flagKey, report.variant);
        counter.requests += report.requests;
        counter.errors += report.errors;
      }
      this.onError(error);
    }
  }

  async close(): Promise<void> {
    this.stop.abort();
    clearInterval(this.flushTimer);
    await this.streamLoop;
    await this.flush();
  }

  private counterFor(flagKey: string, variant: boolean): Counter {
    const id = `${flagKey}\u0000${variant}`;
    let counter = this.counters.get(id);
    if (!counter) {
      counter = { flagKey, variant, requests: 0, errors: 0 };
      this.counters.set(id, counter);
    }
    return counter;
  }

  private start(): void {
    this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs);
    (this.flushTimer as { unref?: () => void }).unref?.();
    this.streamLoop = this.runStream();
  }

  private async runStream(): Promise<void> {
    let delay = 250;
    while (!this.stop.signal.aborted) {
      try {
        await this.readStream();
        delay = 250;
      } catch (error) {
        if (this.stop.signal.aborted) {
          return;
        }
        this.onError(error);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        this.stop.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      delay = Math.min(delay * 2, this.maxReconnectDelayMs);
    }
  }

  private async readStream(): Promise<void> {
    const connection = new AbortController();
    const abort = () => connection.abort();
    this.stop.signal.addEventListener("abort", abort, { once: true });
    let idle: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(abort, this.idleTimeoutMs);
    };

    try {
      resetIdle();
      const response = await this.fetchImpl(`${this.baseUrl}/sdk/stream`, {
        headers: { "x-sdk-key": this.sdkKey, accept: "text/event-stream" },
        signal: connection.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Stream failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "message";
      let data = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          throw new Error("Stream closed by server");
        }
        resetIdle();
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");

          if (line === "") {
            if (data && eventName === "snapshot") {
              this.apply(JSON.parse(data) as FlagSnapshot);
            }
            eventName = "message";
            data = "";
          } else if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            data += line.slice(5).trimStart();
          }
        }
      }
    } finally {
      clearTimeout(idle);
      this.stop.signal.removeEventListener("abort", abort);
      connection.abort();
    }
  }

  private apply(snapshot: FlagSnapshot): void {
    if (snapshot.revision < this.currentRevision) {
      return;
    }
    this.flags = new Map(snapshot.flags.map((flag) => [flag.key, flag]));
    this.currentRevision = snapshot.revision;
    this.isReady = true;
    this.resolveReady();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

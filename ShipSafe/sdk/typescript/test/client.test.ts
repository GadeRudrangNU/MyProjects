import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ShipSafeClient } from "../src/client.js";
import type { FlagDefinition, FlagSnapshot } from "../src/types.js";

const guard = { enabled: true, mode: "auto", minSamples: 100, alpha: 0.001, minDifference: 0.05, windowSeconds: 30 } as const;

function flag(key: string, rolloutPercent: number, enabled = true): FlagDefinition {
  return { key, description: "", enabled, rolloutPercent, conditions: [], guard, version: 1, updatedAt: "" };
}

class FakeServer {
  readonly streams = new Set<ServerResponse>();
  readonly reports: { flagKey: string; variant: boolean; requests: number; errors: number }[] = [];
  readonly keys: string[] = [];
  snapshot: FlagSnapshot = { revision: 1, flags: [flag("checkout", 100)] };
  failEvents = false;
  private server!: Server;

  async start(port = 0): Promise<string> {
    this.server = createServer((request, response) => this.handle(request, response));
    await new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    for (const stream of this.streams) stream.destroy();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  push(snapshot: FlagSnapshot): void {
    this.snapshot = snapshot;
    for (const stream of this.streams) this.write(stream);
  }

  dropStreams(): void {
    for (const stream of this.streams) stream.destroy();
    this.streams.clear();
  }

  private write(stream: ServerResponse): void {
    stream.write(`event: snapshot\ndata: ${JSON.stringify(this.snapshot)}\n\n`);
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    this.keys.push(String(request.headers["x-sdk-key"]));
    if (request.url === "/sdk/stream") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": hello\n\n");
      this.streams.add(response);
      this.write(response);
      request.on("close", () => this.streams.delete(response));
      return;
    }
    if (request.url === "/sdk/events" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        if (this.failEvents) {
          response.writeHead(503).end();
          return;
        }
        this.reports.push(...JSON.parse(body).reports);
        response.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
      return;
    }
    response.writeHead(404).end();
  }
}

async function until(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("ShipSafeClient", () => {
  let fake: FakeServer;
  let baseUrl: string;
  let client: ShipSafeClient | undefined;

  beforeEach(async () => {
    fake = new FakeServer();
    baseUrl = await fake.start();
  });

  afterEach(async () => {
    await client?.close();
    client = undefined;
    await fake.stop();
  });

  it("loads flags from the stream and sends the SDK key", async () => {
    client = await ShipSafeClient.create({ baseUrl, sdkKey: "secret", flushIntervalMs: 50 });

    expect(client.ready).toBe(true);
    expect(client.isEnabled("checkout", { id: "u1" })).toBe(true);
    expect(client.evaluate("missing", { id: "u1" }).reason).toBe("flagNotFound");
    expect(fake.keys[0]).toBe("secret");
  });

  it("applies updates pushed by the server within a second", async () => {
    fake.snapshot = { revision: 1, flags: [flag("checkout", 0)] };
    client = await ShipSafeClient.create({ baseUrl, sdkKey: "k", flushIntervalMs: 50 });
    expect(client.isEnabled("checkout", { id: "u1" })).toBe(false);

    const started = Date.now();
    fake.push({ revision: 2, flags: [flag("checkout", 100)] });
    await until(() => client!.isEnabled("checkout", { id: "u1" }));

    expect(Date.now() - started).toBeLessThan(1000);
    expect(client.revision).toBe(2);
  });

  it("notifies listeners and ignores stale snapshots", async () => {
    client = await ShipSafeClient.create({ baseUrl, sdkKey: "k", flushIntervalMs: 50 });
    const seen: number[] = [];
    const stop = client.onUpdate((s) => seen.push(s.revision));

    fake.push({ revision: 5, flags: [flag("checkout", 100)] });
    await until(() => seen.includes(5));
    fake.push({ revision: 3, flags: [flag("checkout", 0)] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    stop();

    expect(client.revision).toBe(5);
    expect(client.isEnabled("checkout", { id: "u1" })).toBe(true);
  });

  it("batches tracked results per flag and variant", async () => {
    client = await ShipSafeClient.create({ baseUrl, sdkKey: "k", flushIntervalMs: 50 });
    const on = client.evaluate("checkout", { id: "u1" });
    for (let i = 0; i < 10; i++) client.track(on, i % 5 !== 0);
    client.track({ flagKey: "checkout", enabled: false, reason: "outsideRollout" }, true);
    client.track(client.evaluate("missing", { id: "u1" }), false);

    await until(() => fake.reports.length >= 2);

    const onReport = fake.reports.find((r) => r.variant);
    const offReport = fake.reports.find((r) => !r.variant);
    expect(onReport).toMatchObject({ flagKey: "checkout", requests: 10, errors: 2 });
    expect(offReport).toMatchObject({ flagKey: "checkout", requests: 1, errors: 0 });
    expect(fake.reports.some((r) => r.flagKey === "missing")).toBe(false);
  });

  it("keeps results that failed to send and delivers them later", async () => {
    client = await ShipSafeClient.create({ baseUrl, sdkKey: "k", flushIntervalMs: 3_600_000, onError: () => {} });
    const decision = client.evaluate("checkout", { id: "u1" });
    for (let i = 0; i < 6; i++) client.track(decision, i !== 0);

    fake.failEvents = true;
    await client.flush();
    expect(fake.reports).toHaveLength(0);

    fake.failEvents = false;
    await client.flush();
    expect(fake.reports).toEqual([{ flagKey: "checkout", variant: true, requests: 6, errors: 1 }]);
  });

  it("reconnects after the stream drops and picks up missed changes", async () => {
    client = await ShipSafeClient.create({ baseUrl, sdkKey: "k", flushIntervalMs: 50, onError: () => {} });
    fake.snapshot = { revision: 9, flags: [flag("checkout", 0)] };
    fake.dropStreams();

    await until(() => client!.revision === 9, 5000);
    expect(client.isEnabled("checkout", { id: "u1" })).toBe(false);
  });

  it("starts degraded when the server is unreachable and recovers later", async () => {
    await fake.stop();
    client = await ShipSafeClient.create({
      baseUrl,
      sdkKey: "k",
      startTimeoutMs: 100,
      maxReconnectDelayMs: 100,
      onError: () => {},
    });

    expect(client.ready).toBe(false);
    expect(client.isEnabled("checkout", { id: "u1" })).toBe(false);

    fake = new FakeServer();
    await fake.start(Number(new URL(baseUrl).port));

    await until(() => client!.ready, 5000);
    expect(client.isEnabled("checkout", { id: "u1" })).toBe(true);
  });
});

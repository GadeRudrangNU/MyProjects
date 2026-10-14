import { api, ApiError, getApiKey, setApiKey } from "./api";

const respond = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }));

beforeEach(() => vi.stubEnv("VITE_DEMO_API_KEY", ""));  // ignore any key in a developer's .env.local
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });

describe("api client", () => {
  it("sends the bearer key and idempotency header", async () => {
    setApiKey("pf_test_abc");
    respond(201, { id: "1", status: "captured" });
    await api("/payments", { method: "POST", body: { amount: 5 }, idempotencyKey: "key-1" });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/v1/payments");
    expect(init.headers.Authorization).toBe("Bearer pf_test_abc");
    expect(init.headers["Idempotency-Key"]).toBe("key-1");
    expect(init.body).toBe('{"amount":5}');
  });

  it("builds query strings and skips empty params", async () => {
    respond(200, { results: [] });
    await api("/payments", { params: { limit: 25, status: "", offset: 0 } });
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/v1/payments?limit=25&offset=0");
  });

  it("treats a declined payment (402) as data, not an exception", async () => {
    respond(402, { id: "1", status: "failed", failure_reason: "insufficient_funds" });
    await expect(api("/payments", { method: "POST", body: {} })).resolves.toMatchObject({ status: "failed" });
  });

  it("turns error envelopes into ApiError", async () => {
    respond(409, { error: { code: "invalid_state_transition", message: "Cannot capture." } });
    await expect(api("/x")).rejects.toMatchObject({ status: 409, code: "invalid_state_transition", message: "Cannot capture." });
    respond(401, { error: { code: "authentication_failed", message: "Invalid API key." } });
    await expect(api("/x")).rejects.toBeInstanceOf(ApiError);
  });

  it("reports an unreachable API clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(api("/x")).rejects.toMatchObject({ code: "network_error" });
  });

  it("stores and clears the key", () => {
    setApiKey("k");
    expect(getApiKey()).toBe("k");
    setApiKey(null);
    expect(getApiKey()).toBe("");
  });
});

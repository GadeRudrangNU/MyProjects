import { api } from "../api";

const mockFetch = (status: number, body?: unknown) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400, status, statusText: "Err",
    json: () => (body === undefined ? Promise.reject(new Error("no body")) : Promise.resolve(body)),
  }) as unknown as typeof fetch;
};

test("GET parses JSON", async () => {
  mockFetch(200, [{ id: 1 }]);
  expect(await api.listModels()).toEqual([{ id: 1 }]);
  expect(global.fetch).toHaveBeenCalledWith("/api/models", undefined);
});

test("POST sends a JSON body", async () => {
  mockFetch(202, { id: 5 });
  await api.launchRun(2, "sample_sentiment");
  const [, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ model_id: 2, dataset: "sample_sentiment" });
});

test("204 resolves to undefined", async () => {
  mockFetch(204);
  await expect(api.deleteModel(1)).resolves.toBeUndefined();
});

test("surfaces the FastAPI `detail` message", async () => {
  mockFetch(409, { detail: "already exists" });
  await expect(api.registerModel({ name: "a", hf_id: "b", description: "" })).rejects.toThrow("already exists");
});

test("falls back to statusText when the error body is not JSON or detail is a validation list", async () => {
  mockFetch(500);
  await expect(api.listRuns()).rejects.toThrow("Err");
  mockFetch(422, { detail: [{ msg: "bad" }] });
  await expect(api.predict(1, "x")).rejects.toThrow("Err");
});

test("uploadDataset posts multipart form data", async () => {
  mockFetch(201, { name: "d", n_samples: 1 });
  await api.uploadDataset(new File(["a"], "d.csv"));
  const [, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(init.body).toBeInstanceOf(FormData);
  expect(await api.listDatasets()).toBeDefined();
});

import type { DatasetInfo, MLModel, Prediction, Run } from "./types";

const BASE = `${__API_URL__}/api`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : res.statusText;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  listModels: () => request<MLModel[]>("/models"),
  registerModel: (m: { name: string; hf_id: string; description: string }) =>
    request<MLModel>("/models", json("POST", m)),
  deleteModel: (id: number) => request<void>(`/models/${id}`, { method: "DELETE" }),
  listDatasets: () => request<DatasetInfo[]>("/datasets"),
  uploadDataset: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<DatasetInfo>("/datasets", { method: "POST", body: form });
  },
  listRuns: () => request<Run[]>("/runs"),
  launchRun: (model_id: number, dataset: string) => request<Run>("/runs", json("POST", { model_id, dataset })),
  predict: (model_id: number, text: string) => request<Prediction>("/predict", json("POST", { model_id, text })),
};

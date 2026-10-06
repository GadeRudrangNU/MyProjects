import { FormEvent, useState } from "react";
import { api } from "../api";
import type { MLModel, Prediction } from "../types";

export function Playground({ models }: { models: MLModel[] }) {
  const [modelId, setModelId] = useState<number | "">("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Prediction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (modelId === "") return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.predict(modelId, text));
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Inference playground</h2>
      <form className="card form" onSubmit={submit} aria-label="Predict">
        <select aria-label="Model" value={modelId} onChange={(e) => setModelId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Select a model…</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <textarea placeholder="Type a sentence to classify…" rows={3} value={text} onChange={(e) => setText(e.target.value)} required />
        <button type="submit" disabled={busy || modelId === ""}>{busy ? "Running…" : "Classify"}</button>
        <p className="muted">The first call to a model downloads and loads it, so it is slower than the rest.</p>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {result && (
        <div className="card result" data-testid="prediction">
          <span className={`badge ${result.label === "positive" ? "completed" : "failed"}`}>{result.label}</span>
          <span>confidence {(result.score * 100).toFixed(1)}%</span>
          <span>{result.latency_ms} ms</span>
        </div>
      )}
    </section>
  );
}

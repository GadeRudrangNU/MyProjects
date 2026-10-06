import { useEffect, useState } from "react";
import { api } from "../api";
import type { DatasetInfo, MLModel, Run } from "../types";
import { isActive, pct } from "../utils";

interface Props {
  models: MLModel[];
  runs: Run[];
  selected: number[];
  onSelect: (ids: number[]) => void;
  onChange: () => void;
}

export function RunsPanel({ models, runs, selected, onSelect, onChange }: Props) {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [modelId, setModelId] = useState<number | "">("");
  const [dataset, setDataset] = useState("sample_sentiment");
  const [error, setError] = useState<string | null>(null);

  const loadDatasets = () => api.listDatasets().then(setDatasets).catch((e: Error) => setError(e.message));
  useEffect(() => { loadDatasets(); }, []);

  async function launch() {
    if (modelId === "") return;
    setError(null);
    try {
      await api.launchRun(modelId, dataset);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const info = await api.uploadDataset(file);
      await loadDatasets();
      setDataset(info.name);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const toggle = (id: number) =>
    onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <section>
      <h2>Evaluation runs</h2>
      <div className="card form row">
        <select aria-label="Model" value={modelId} onChange={(e) => setModelId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Select a model…</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select aria-label="Dataset" value={dataset} onChange={(e) => setDataset(e.target.value)}>
          {datasets.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.n_samples})</option>)}
        </select>
        <label className="file">
          Upload CSV
          <input type="file" accept=".csv" aria-label="Upload CSV" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        <button onClick={launch} disabled={modelId === ""}>Launch run</button>
      </div>
      <p className="muted">CSV needs <code>text</code> and <code>label</code> (positive/negative) columns.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <table>
        <thead>
          <tr><th>Compare</th><th>Run</th><th>Dataset</th><th>Status</th><th>Accuracy</th><th>F1</th><th>p95 latency</th></tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Compare run ${r.id}`}
                  disabled={r.status !== "completed"}
                  checked={selected.includes(r.id)}
                  onChange={() => toggle(r.id)}
                />
              </td>
              <td>#{r.id} {r.model_name}</td>
              <td>{r.dataset}</td>
              <td>
                <span className={`badge ${r.status}`}>{r.status}</span>
                {isActive(r) && <span className="spinner" aria-hidden />}
                {r.error && <div className="error small" title={r.error}>{r.error}</div>}
              </td>
              <td>{r.metrics ? pct(r.metrics.accuracy) : "–"}</td>
              <td>{r.metrics ? pct(r.metrics.f1) : "–"}</td>
              <td>{r.metrics ? `${r.metrics.latency_ms.p95} ms` : "–"}</td>
            </tr>
          ))}
          {runs.length === 0 && <tr><td colSpan={7} className="muted">No runs yet. Launch one above.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

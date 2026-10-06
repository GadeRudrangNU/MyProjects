import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { ComparePanel } from "./components/ComparePanel";
import { ModelsPanel } from "./components/ModelsPanel";
import { Playground } from "./components/Playground";
import { RunsPanel } from "./components/RunsPanel";
import type { MLModel, Run } from "./types";
import { isActive } from "./utils";

const TABS = ["Runs", "Compare", "Models", "Playground"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [tab, setTab] = useState<Tab>("Runs");
  const [models, setModels] = useState<MLModel[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([api.listModels(), api.listRuns()]);
      setModels(m);
      setRuns(r);
      setError(null);
    } catch (err) {
      setError(`Cannot reach the API: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll only while something is in flight.
  const active = runs.some(isActive);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [active, refresh]);

  return (
    <div className="app">
      <header>
        <h1>ModelBench</h1>
        <p className="muted">Register models, run evaluations, compare metrics.</p>
        <nav role="tablist">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t}{t === "Compare" && selected.length > 0 ? ` (${selected.length})` : ""}
            </button>
          ))}
        </nav>
      </header>
      {error && <p role="alert" className="error banner">{error}</p>}
      <main>
        {tab === "Runs" && <RunsPanel models={models} runs={runs} selected={selected} onSelect={setSelected} onChange={refresh} />}
        {tab === "Compare" && <ComparePanel runs={runs.filter((r) => selected.includes(r.id))} />}
        {tab === "Models" && <ModelsPanel models={models} onChange={refresh} />}
        {tab === "Playground" && <Playground models={models} />}
      </main>
    </div>
  );
}

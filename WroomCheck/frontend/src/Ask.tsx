import { useState } from "react";
import type { Data } from "./api";
import type { AskResult } from "./types";

export default function Ask({ data }: { data: Data }) {
  const [q, setQ] = useState("Are owners reporting the engine stalling while driving?");
  const [make, setMake] = useState("");
  const [res, setRes] = useState<AskResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!data.live)
    return (
      <p className="muted">
        The Ask tab runs RAG over the full complaint corpus in pgvector, so it needs the live API. Start Postgres and the API
        (see the README), then reload.
      </p>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      setRes(await data.ask(q, make));
    } catch (x) {
      setErr(String(x instanceof Error ? x.message : x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <form onSubmit={submit} className="ask">
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question" />
        <select value={make} onChange={(e) => setMake(e.target.value)} aria-label="Make">
          <option value="">All makes</option>
          {data.meta.makes.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <button disabled={busy || !q.trim()}>{busy ? "Searching…" : "Ask"}</button>
      </form>
      {err && <p className="callout miss">{err}</p>}
      {res && (
        <>
          <p className="summary">
            {res.answer} <span className="pill">{res.mode}</span>
          </p>
          <ul className="evidence">
            {res.sources.map((s) => (
              <li key={s.id}>
                <span className="muted">
                  C{s.id} · {s.date} · {s.make} {s.model} MY{s.year} · similarity {s.similarity}
                </span>
                <div>{s.text}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

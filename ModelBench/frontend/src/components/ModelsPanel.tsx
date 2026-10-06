import { FormEvent, useState } from "react";
import { api } from "../api";
import type { MLModel } from "../types";

interface Props {
  models: MLModel[];
  onChange: () => void;
}

export function ModelsPanel({ models, onChange }: Props) {
  const [name, setName] = useState("");
  const [hfId, setHfId] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.registerModel({ name: name.trim(), hf_id: hfId.trim(), description: description.trim() });
      setName("");
      setHfId("");
      setDescription("");
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(m: MLModel) {
    try {
      await api.deleteModel(m.id);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <h2>Model registry</h2>
      <form className="card form" onSubmit={submit} aria-label="Register model">
        <input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input
          placeholder="Hugging Face id, e.g. distilbert-base-uncased-finetuned-sst-2-english"
          value={hfId}
          onChange={(e) => setHfId(e.target.value)}
          required
        />
        <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button type="submit">Register model</button>
        {error && <p role="alert" className="error">{error}</p>}
      </form>
      <table>
        <thead>
          <tr><th>Name</th><th>Source</th><th>Description</th><th /></tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td><code>{m.hf_id}</code></td>
              <td>{m.description}</td>
              <td><button className="ghost" onClick={() => remove(m)} aria-label={`Delete ${m.name}`}>Delete</button></td>
            </tr>
          ))}
          {models.length === 0 && <tr><td colSpan={4} className="muted">No models registered yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

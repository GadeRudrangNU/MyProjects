import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, api, toInput, type Condition, type Flag, type FlagInput, type Guard } from "../api";
import { navigate } from "../useHash";
import { Switch } from "./Switch";

const blankGuard: Guard = {
  enabled: true,
  mode: "auto",
  minSamples: 200,
  alpha: 0.001,
  minDifference: 0.02,
  windowSeconds: 60,
};

const blank: FlagInput = {
  key: "",
  description: "",
  enabled: false,
  rolloutPercent: 0,
  conditions: [],
  guard: blankGuard,
};

export function FlagEditor({ flag }: { flag?: Flag }) {
  const client = useQueryClient();
  const [form, setForm] = useState<FlagInput>(flag ? toInput(flag) : blank);
  const [valuesText, setValuesText] = useState<string[]>(() => form.conditions.map((c) => c.values.join(", ")));
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadedVersion, setLoadedVersion] = useState(flag?.version);

  const load = (source: Flag) => {
    const input = toInput(source);
    setForm(input);
    setValuesText(input.conditions.map((c) => c.values.join(", ")));
    setLoadedVersion(source.version);
    setDirty(false);
  };

  if (flag && flag.version !== loadedVersion && !dirty) {
    load(flag);
  }

  const changedElsewhere = flag !== undefined && dirty && flag.version !== loadedVersion;

  const save = useMutation({
    mutationFn: (input: FlagInput) => (flag ? api.updateFlag(input) : api.createFlag(input)),
    onSuccess: (result) => {
      client.invalidateQueries();
      if (flag) {
        load(result);
        setSaved(true);
      } else {
        navigate(`/flags/${encodeURIComponent(result.key)}`);
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteFlag(form.key),
    onSuccess: () => {
      client.invalidateQueries();
      navigate("/");
    },
  });

  const fieldErrors = save.error instanceof ApiError ? save.error.fields : {};
  const update = (patch: Partial<FlagInput>) => {
    setSaved(false);
    setDirty(true);
    setForm((current) => ({ ...current, ...patch }));
  };
  const updateGuard = (patch: Partial<Guard>) => update({ guard: { ...form.guard, ...patch } });

  const updateCondition = (index: number, patch: Partial<Condition>) =>
    update({ conditions: form.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const conditions = form.conditions.map((c, i) => ({
      ...c,
      values: (valuesText[i] ?? "").split(",").map((v) => v.trim()).filter(Boolean),
    }));
    save.mutate({ ...form, conditions });
  };

  const error = (field: string) =>
    fieldErrors[field] ? <p className="field-error" role="alert">{fieldErrors[field]!.join(" ")}</p> : null;

  return (
    <form className="card form" onSubmit={submit} aria-label="Flag settings">
      <h2>Settings</h2>

      {changedElsewhere && (
        <p className="notice" role="note">
          This flag was changed elsewhere (for example by an automatic rollback).{" "}
          <button type="button" className="ghost" onClick={() => load(flag)}>
            Discard my edits and load the latest
          </button>
        </p>
      )}

      {!flag && (
        <label>
          <span>Key</span>
          <input
            value={form.key}
            placeholder="new-checkout"
            onChange={(e) => update({ key: e.target.value })}
            autoFocus
          />
          {error("key")}
        </label>
      )}

      <label>
        <span>Description</span>
        <input value={form.description} onChange={(e) => update({ description: e.target.value })} />
        {error("description")}
      </label>

      <div className="row">
        <span id="flag-on-label">Flag is on</span>
        <Switch checked={form.enabled} label="Flag is on" onChange={(enabled) => update({ enabled })} />
      </div>

      <label>
        <span>Rollout percentage</span>
        <div className="range">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={form.rolloutPercent}
            aria-label="Rollout slider"
            onChange={(e) => update({ rolloutPercent: Number(e.target.value) })}
          />
          <input
            className="narrow"
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={form.rolloutPercent}
            aria-label="Rollout percentage"
            onChange={(e) => update({ rolloutPercent: Number(e.target.value) })}
          />
          <span>%</span>
        </div>
        {error("rolloutPercent")}
      </label>

      <fieldset>
        <legend>Targeting rules</legend>
        <p className="muted small">Users must match every rule before the rollout percentage applies.</p>
        {form.conditions.map((condition, index) => (
          <div className="rule" key={index}>
            <input
              aria-label={`Rule ${index + 1} attribute`}
              placeholder="country"
              value={condition.attribute}
              onChange={(e) => updateCondition(index, { attribute: e.target.value })}
            />
            <select
              aria-label={`Rule ${index + 1} operator`}
              value={condition.operator}
              onChange={(e) => updateCondition(index, { operator: e.target.value as Condition["operator"] })}
            >
              <option value="in">is one of</option>
              <option value="notIn">is not one of</option>
            </select>
            <input
              aria-label={`Rule ${index + 1} values`}
              placeholder="CA, US"
              value={valuesText[index] ?? ""}
              onChange={(e) => {
                setSaved(false);
                setDirty(true);
                setValuesText((current) => current.map((v, i) => (i === index ? e.target.value : v)));
              }}
            />
            <button
              type="button"
              className="ghost"
              aria-label={`Remove rule ${index + 1}`}
              onClick={() => {
                update({ conditions: form.conditions.filter((_, i) => i !== index) });
                setValuesText((current) => current.filter((_, i) => i !== index));
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {error("conditions")}
        <button
          type="button"
          className="ghost"
          onClick={() => {
            update({ conditions: [...form.conditions, { attribute: "", operator: "in", values: [] }] });
            setValuesText((current) => [...current, ""]);
          }}
        >
          Add rule
        </button>
      </fieldset>

      <fieldset>
        <legend>Automatic rollback</legend>
        <div className="row">
          <span>Watch error rates</span>
          <Switch checked={form.guard.enabled} label="Rollback guard" onChange={(enabled) => updateGuard({ enabled })} />
        </div>
        <label>
          <span>When a regression is found</span>
          <select
            value={form.guard.mode}
            onChange={(e) => updateGuard({ mode: e.target.value as Guard["mode"] })}
            disabled={!form.guard.enabled}
          >
            <option value="auto">Switch the flag off automatically</option>
            <option value="approval">Ask a person to approve</option>
          </select>
        </label>
        <div className="grid">
          <label>
            <span>Minimum requests per version</span>
            <input
              type="number"
              min={1}
              value={form.guard.minSamples}
              disabled={!form.guard.enabled}
              onChange={(e) => updateGuard({ minSamples: Number(e.target.value) })}
            />
            {error("guard.minSamples")}
          </label>
          <label>
            <span>Window (seconds)</span>
            <input
              type="number"
              min={5}
              max={3600}
              value={form.guard.windowSeconds}
              disabled={!form.guard.enabled}
              onChange={(e) => updateGuard({ windowSeconds: Number(e.target.value) })}
            />
            {error("guard.windowSeconds")}
          </label>
          <label>
            <span>Significance (p-value)</span>
            <input
              type="number"
              min={0.00001}
              max={0.49}
              step="any"
              value={form.guard.alpha}
              disabled={!form.guard.enabled}
              onChange={(e) => updateGuard({ alpha: Number(e.target.value) })}
            />
            {error("guard.alpha")}
          </label>
          <label>
            <span>Minimum extra errors (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={Math.round(form.guard.minDifference * 1000) / 10}
              disabled={!form.guard.enabled}
              onChange={(e) => updateGuard({ minDifference: Number(e.target.value) / 100 })}
            />
            {error("guard.minDifference")}
          </label>
        </div>
      </fieldset>

      {save.error && !(save.error instanceof ApiError && Object.keys(save.error.fields).length > 0) && (
        <p role="alert" className="error">{save.error.message}</p>
      )}

      <div className="actions">
        <button className="primary" type="submit" disabled={save.isPending}>
          {flag ? "Save changes" : "Create flag"}
        </button>
        {saved && <span className="saved" role="status">Saved</span>}
        {flag && (
          <button
            type="button"
            className="danger ghost-danger"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete ${flag.key}? Apps will treat it as off.`)) {
                remove.mutate();
              }
            }}
          >
            Delete flag
          </button>
        )}
      </div>
    </form>
  );
}

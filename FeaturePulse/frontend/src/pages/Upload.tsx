import { useState } from 'react'
import { api } from '../api'
import { PageHeader, Panel, fmt, useFetch } from '../components/ui'

const FIELDS: [string, string, boolean][] = [
  ['text', 'Feedback text', true], ['date', 'Date', false], ['rating', 'Rating', false],
  ['source', 'Source', false], ['segment', 'Customer segment', false], ['product_area', 'Product area', false],
]

export default function Upload() {
  const runs = useFetch(() => api('/ingestion-runs'), [])
  const [file, setFile] = useState<File | null>(null)
  const [prev, setPrev] = useState<any>(null)
  const [map, setMap] = useState<Record<string, string>>({})
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = async (f: File | null) => {
    setFile(f); setPrev(null); setResult(null); setError(null)
    if (!f) return
    const fd = new FormData(); fd.append('file', f)
    try {
      const p = await api('/feedback/upload/preview', { method: 'POST', body: fd })
      setPrev(p); setMap(Object.fromEntries(Object.entries(p.suggested_mapping).filter(([, v]) => v) as [string, string][]))
    } catch (e: any) { setError(e.message) }
  }
  const run = async () => {
    if (!file) return
    setBusy(true); setError(null); setResult(null)
    const fd = new FormData(); fd.append('file', file); fd.append('mapping', JSON.stringify(map)); if (label) fd.append('source_label', label)
    try { setResult(await api('/feedback/upload', { method: 'POST', body: fd })); runs.reload() }
    catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div>
      <PageHeader title="Data & Ingestion" subtitle="The public dataset is seeded by the pipeline. Upload a CSV to add your own feedback: map its columns, validate, then each row is embedded locally and assigned to the nearest theme." />
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Upload CSV">
          <input type="file" accept=".csv,text/csv" onChange={e => choose(e.target.files?.[0] ?? null)} />
          {prev && (
            <div className="mt-4">
              <div className="text-xs text-slate-500 mb-2">{fmt(prev.row_count)} rows · {prev.columns.length} columns. Map the columns (only text is required; unmapped fields stay unknown).</div>
              <div className="grid grid-cols-2 gap-2">
                {FIELDS.map(([k, label, req]) => (
                  <label key={k} className="text-xs text-slate-600 flex flex-col gap-0.5">{label}{req && ' *'}
                    <select value={map[k] ?? ''} onChange={e => setMap({ ...map, [k]: e.target.value })}>
                      <option value="">— none —</option>{prev.columns.map((c: string) => <option key={c}>{c}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {!map.source && <label className="text-xs text-slate-600 flex flex-col gap-0.5 mt-2">Source label for all rows<input placeholder="e.g. support_ticket" value={label} onChange={e => setLabel(e.target.value)} /></label>}
              <div className="overflow-x-auto mt-3 border border-slate-200 rounded"><table className="w-full text-xs"><thead><tr>{prev.columns.map((c: string) => <th key={c}>{c}</th>)}</tr></thead><tbody>{prev.sample.map((r: any, i: number) => <tr key={i}>{prev.columns.map((c: string) => <td key={c} className="max-w-[200px] truncate">{r[c]}</td>)}</tr>)}</tbody></table></div>
              <button className="btn btn-primary mt-3" disabled={!map.text || busy} onClick={run}>{busy ? 'Embedding & importing…' : 'Validate and import'}</button>
            </div>
          )}
          {error && <div className="mt-3 text-sm rounded-md border border-red-200 bg-red-50 text-red-700 p-2">{error}</div>}
          {result && (
            <div className="mt-3 text-sm rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <b>Imported {fmt(result.imported)} of {fmt(result.rows_read)} rows.</b>
              <ul className="text-xs mt-1 text-slate-700 list-disc ml-4">
                <li>{fmt(result.assigned_to_existing_theme)} assigned to existing themes, {fmt(result.uncategorized)} uncategorized</li>
                <li>Dropped: {result.dropped_empty_text} empty · {result.dropped_too_short_or_noisy} too short/noisy · {result.dropped_non_english} non-English</li>
                <li>Duplicates: {result.duplicates_in_file} in file · {result.duplicates_existing} already in database</li>
                <li>Unparseable dates (kept, date unknown): {result.invalid_dates} · invalid ratings: {result.invalid_ratings}</li>
              </ul>
            </div>
          )}
        </Panel>
        <Panel title="Ingestion runs">
          <table className="w-full text-sm">
            <thead><tr><th>#</th><th>Source</th><th>When</th><th className="text-right">Imported</th></tr></thead>
            <tbody>
              {(runs.data ?? []).map((r: any) => (
                <tr key={r.id}><td className="tnum">{r.id}</td><td><div>{r.source}</div><div className="text-xs text-slate-500 truncate max-w-[230px]">{r.filename}</div></td><td className="text-xs text-slate-500">{r.started_at.slice(0, 16).replace('T', ' ')}</td><td className="text-right tnum">{fmt(r.stats?.imported ?? r.stats?.kept_after_sampling)}</td></tr>
              ))}
            </tbody>
          </table>
          {(runs.data ?? [])[runs.data?.length - 1]?.stats?.raw_records && (() => {
            const s = runs.data[runs.data.length - 1].stats
            return (
              <div className="mt-3 text-xs text-slate-600 border-t border-slate-100 pt-3">
                <b>Seeded dataset cleaning:</b> {fmt(s.raw_records)} raw → dropped {fmt(s.too_short_or_noisy)} too short/noisy, {fmt(s.non_english)} non-English, {fmt(s.exact_duplicates_consolidated)} exact duplicates consolidated → {fmt(s.kept_before_sampling)} clean → {fmt(s.kept_after_sampling)} after capping at {fmt(s.sample_cap_per_app)} per app.
              </div>
            )
          })()}
        </Panel>
      </div>
    </div>
  )
}

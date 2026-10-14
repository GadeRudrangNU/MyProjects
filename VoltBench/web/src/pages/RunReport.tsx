import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { useParams } from 'react-router-dom'
import { useGetRunQuery, useGetTelemetryQuery } from '../api'
import { Empty, ErrorState, Loading, VerdictCell } from '../components/common'
import type { RunDetail, TestResult } from '../types'
import { wsUrl } from '../useTelemetry'

interface RunMessage {
  status: string
  results: TestResult[]
}

export default function RunReport() {
  const id = Number(useParams().id)
  const { data, error, isLoading, refetch } = useGetRunQuery(id)
  const [live, setLive] = useState<{ status: string; results: Map<number, TestResult> } | null>(null)
  const [selected, setSelected] = useState<TestResult | null>(null)

  useEffect(() => {
    if (!data || ['completed', 'failed'].includes(data.run.status)) return
    const socket = new WebSocket(wsUrl(`/ws/runs/${id}`))
    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as RunMessage
      setLive((prev) => {
        const results = new Map(prev?.results ?? [])
        for (const r of msg.results) results.set(r.id, r)
        return { status: msg.status, results }
      })
    }
    return () => socket.close()
  }, [id, data])

  const results = useMemo(() => {
    const map = new Map<number, TestResult>((data?.results ?? []).map((r) => [r.id, r]))
    live?.results.forEach((r, k) => map.set(k, r))
    return [...map.values()]
  }, [data, live])

  if (isLoading) return <Loading what="run" />
  if (error || !data) return <ErrorState error={error} retry={refetch} />

  const status = live?.status ?? data.run.status
  return (
    <section>
      <header className="page-head">
        <h1>Run #{id}</h1>
        <span className={`badge run-${status}`}>{status}</span>
        <span className="muted">{data.run.plan}</span>
        <span className="spacer" />
        <a className="btn secondary" href={`/api/test-runs/${id}/report.csv`} download>
          Export CSV
        </a>
      </header>
      <Progress run={data} results={results} status={status} />
      <Matrix run={data} results={results} selected={selected} onSelect={setSelected} />
      {selected ? <CellReport result={selected} /> : results.length > 0 && <Empty>Select a cell to see measured values, the step timeline and raw data.</Empty>}
    </section>
  )
}

function Progress({ run, results, status }: { run: RunDetail; results: TestResult[]; status: string }) {
  const counts = { PASS: 0, FAIL: 0, FLAKY: 0, ERROR: 0 }
  for (const r of results) counts[r.verdict]++
  const expected = run.run.device_ids.length * run.run.tests.length
  const done = results.length
  return (
    <div className="progress-box" data-testid="progress">
      <div className="progress-bar">
        <div style={{ width: `${Math.min(100, (done / Math.max(expected, 1)) * 100)}%` }} className={status === 'completed' ? 'done' : ''} />
      </div>
      <div className="verdict-row">
        <span className="muted">{done} results</span>
        {(Object.keys(counts) as (keyof typeof counts)[]).map((v) => (
          <span key={v} className={`mini verdict-${v.toLowerCase()}`}>
            {counts[v]} {v}
          </span>
        ))}
      </div>
    </div>
  )
}

function Matrix({
  run,
  results,
  selected,
  onSelect,
}: {
  run: RunDetail
  results: TestResult[]
  selected: TestResult | null
  onSelect: (r: TestResult) => void
}) {
  const byCell = new Map(results.map((r) => [`${r.device_id}/${r.test}`, r]))
  const devices = new Map<number, string>()
  for (const r of results) devices.set(r.device_id, r.serial)
  const rows = [...new Set([...run.run.device_ids])].sort((a, b) => a - b)
  return (
    <div className="matrix-wrap">
      <table className="matrix" data-testid="matrix">
        <thead>
          <tr>
            <th>Device</th>
            {run.run.tests.map((t) => (
              <th key={t.id} title={t.name}>
                {t.name.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d}>
              <th>{devices.get(d) ?? `#${d}`}</th>
              {run.run.tests.map((t) => {
                const r = byCell.get(`${d}/${t.name}`)
                return (
                  <td key={t.id} className={selected && r && selected.id === r.id ? 'sel' : ''} data-testid={`cell-${d}-${t.name}`}>
                    <VerdictCell verdict={r?.verdict} label={r?.message} onClick={r ? () => onSelect(r) : undefined} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CellReport({ result }: { result: TestResult }) {
  const start = new Date(result.started_at).getTime()
  const end = new Date(result.ended_at).getTime()
  const from = start - 1500
  const to = end + 500
  const telemetry = useGetTelemetryQuery({ id: result.device_id, from, to })
  const signals = useMemo(() => [...new Set((telemetry.data ?? []).map((p) => p.signal))].filter((s) => s !== 'output_state'), [telemetry.data])
  const [signal, setSignal] = useState('')
  const active = signal && signals.includes(signal) ? signal : signals[0]
  const points = (telemetry.data ?? []).filter((p) => p.signal === active)
  const signalsMeasured = (result.measured.signals ?? {}) as Record<string, Record<string, number | boolean>>
  const scalars = Object.entries(result.measured).filter(([k, v]) => k !== 'signals' && k !== 'vars' && k !== 'first_attempt' && typeof v !== 'object')

  return (
    <div className="report" data-testid="cell-report">
      <div className="report-head">
        <h2>
          {result.test} on {result.serial}
        </h2>
        <VerdictCell verdict={result.verdict} />
        <span className="muted">attempt {result.attempt}</span>
      </div>
      {result.message && <p className={result.verdict === 'PASS' ? 'muted' : 'bad'}>{result.message}</p>}

      <div className="two-col">
        <div className="panel">
          <h3>Measured against limits</h3>
          <table className="table">
            <tbody>
              {scalars.map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="mono">{typeof v === 'number' ? v.toFixed(3) : String(v)}</td>
                </tr>
              ))}
              {Object.entries(result.limits).map(([k, v]) => (
                <tr key={k}>
                  <td className="muted">limit {k}</td>
                  <td className="mono muted">{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {Object.keys(signalsMeasured).length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>signal</th>
                  <th>mean</th>
                  <th>std</th>
                  <th>range</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {Object.entries(signalsMeasured).map(([name, s]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="mono">{Number(s.mean).toFixed(3)}</td>
                    <td className="mono">{Number(s.std).toFixed(4)}</td>
                    <td className="mono muted">
                      {Number(s.range_lo)}–{Number(s.range_hi)}
                    </td>
                    <td>{s.passed === false ? <span className="bad">fail</span> : <span className="good">ok</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="panel">
          <h3>Step timeline</h3>
          <ol className="timeline">
            {result.steps.map((s) => (
              <li key={s.index} className={s.ok ? '' : 'failed'}>
                <span className="step-kind">{s.kind}</span>
                <span className="muted">{s.ms} ms</span>
                <div>{s.detail}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="panel">
        <div className="row">
          <h3>Raw telemetry around the test</h3>
          <select value={active ?? ''} onChange={(e) => setSignal(e.target.value)} aria-label="Signal">
            {signals.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        {telemetry.isLoading && <Loading what="telemetry" />}
        {telemetry.error && <ErrorState error={telemetry.error} />}
        {telemetry.data && points.length === 0 && <Empty>No telemetry was stored for this window.</Empty>}
        {points.length > 0 && (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="ts" type="number" domain={[from, to]} tickFormatter={(t: number) => `${((t - start) / 1000).toFixed(1)}s`} stroke="var(--muted)" fontSize={11} />
              <YAxis width={52} domain={['auto', 'auto']} stroke="var(--muted)" fontSize={11} />
              <ReferenceArea x1={start} x2={end} fill="var(--accent)" fillOpacity={0.07} />
              <Line type="monotone" dataKey="value" stroke="var(--accent)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

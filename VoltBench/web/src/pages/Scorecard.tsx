import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useGetScorecardQuery, useGetScorecardsQuery, type Scorecard as ScorecardData } from '../api'
import { Empty, ErrorState, Loading, Tile, pct } from '../components/common'

export default function Scorecard() {
  const list = useGetScorecardsQuery()
  const [picked, setPicked] = useState('')
  const id = picked || list.data?.[0]?.campaign_id || ''
  const card = useGetScorecardQuery(id, { skip: !id })

  return (
    <section>
      <header className="page-head">
        <h1>Validation scorecard</h1>
        {list.data && list.data.length > 0 && (
          <select value={id} onChange={(e) => setPicked(e.target.value)} aria-label="Campaign">
            {list.data.map((c) => (
              <option key={c.campaign_id}>{c.campaign_id}</option>
            ))}
          </select>
        )}
      </header>
      {list.isLoading && <Loading what="campaigns" />}
      {list.error && <ErrorState error={list.error} retry={list.refetch} />}
      {list.data?.length === 0 && <Empty>No campaigns yet. Run the evaluator to produce a scorecard.</Empty>}
      {card.isLoading && id && <Loading what="scorecard" />}
      {card.error && <ErrorState error={card.error} retry={card.refetch} />}
      {card.data && <Body card={card.data} />}
    </section>
  )
}

function Body({ card }: { card: ScorecardData }) {
  const { overall: o, rates, targets, monitor } = card
  const faultTypes = Object.keys(card.severity_curve)
  const [type, setType] = useState('')
  const active = faultTypes.includes(type) ? type : (faultTypes.find((t) => card.severity_curve[t].length > 1) ?? faultTypes[0])
  const curve = (card.severity_curve[active] ?? []).map((b) => ({
    bucket: b.lo === b.hi ? 'fixed' : `${fmtSev(b.lo)}–${fmtSev(b.hi)}`,
    tests: b.test_rate == null ? null : b.test_rate * 100,
    monitor: b.monitor_rate == null ? null : b.monitor_rate * 100,
    n: b.n,
  }))
  const hist = monitor.mttd_histogram.map((b) => ({ bin: `${b.lo.toFixed(1)}–${b.hi.toFixed(1)}s`, count: b.count }))

  return (
    <>
      <p className="muted">
        {card.config.devices} devices, {card.config.runs} runs, seed {card.config.seed}, {card.totals.faults_injected} faults injected,{' '}
        {card.totals.evaluated} results scored.
      </p>
      <div className="tiles">
        <Tile label="Detection rate" value={pct(o.recall)} hint={`target ≥ ${pct(targets.recall, 0)}`} tone={(o.recall ?? 0) >= targets.recall ? 'good' : 'bad'} />
        <Tile label="Precision" value={pct(o.precision)} hint={`target ≥ ${pct(targets.precision, 0)}`} tone={(o.precision ?? 0) >= targets.precision ? 'good' : 'bad'} />
        <Tile label="False alarm rate" value={pct(o.false_alarm_rate)} hint={`target ≤ ${pct(targets.false_alarm_rate, 0)}`} tone={(o.false_alarm_rate ?? 0) <= targets.false_alarm_rate ? 'good' : 'bad'} />
        <Tile label="F1" value={pct(o.f1)} />
        <Tile label="Fault coverage" value={rates.fault_coverage} hint="types caught at least once" />
        <Tile label="Flaky / error" value={`${pct(rates.flaky_rate, 2)} / ${pct(rates.error_rate, 2)}`} />
        <Tile label="MTTD (monitors)" value={monitor.mttd_s.median == null ? 'n/a' : `${monitor.mttd_s.median.toFixed(1)}s`} hint={monitor.mttd_s.p95 == null ? '' : `p95 ${monitor.mttd_s.p95.toFixed(1)}s`} />
      </div>

      <div className="two-col">
        <div className="panel">
          <h2>Confusion matrix</h2>
          <table className="confusion" data-testid="confusion">
            <thead>
              <tr>
                <th />
                <th>Predicted FAIL</th>
                <th>Predicted not FAIL</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Fault active</th>
                <td className="tp">{o.tp}</td>
                <td className="fn">{o.fn}</td>
              </tr>
              <tr>
                <th>No fault</th>
                <td className="fp">{o.fp}</td>
                <td className="tn">{o.tn}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Per fault type</h2>
          <table className="table">
            <thead>
              <tr>
                <th>type</th>
                <th>injected</th>
                <th>test recall</th>
                <th>monitor</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(card.by_fault_type).map(([t, v]) => {
                const m = monitor.by_fault_type[t]
                return (
                  <tr key={t}>
                    <td>{t}</td>
                    <td>{v.injected}</td>
                    <td>
                      <span className="meter">
                        <span style={{ width: `${(v.recall ?? 0) * 100}%` }} />
                      </span>{' '}
                      {pct(v.recall, 0)}
                    </td>
                    <td className="muted">{m ? `${m.detected}/${m.injected}` : 'not visible'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="row">
            <h2>Detection vs severity</h2>
            <select value={active} onChange={(e) => setType(e.target.value)} aria-label="Fault type">
              {faultTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          {curve.length === 0 ? (
            <Empty>No faults of this type.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={curve} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="bucket" stroke="var(--muted)" fontSize={11} />
                <YAxis domain={[0, 100]} unit="%" stroke="var(--muted)" fontSize={11} width={44} />
                <Tooltip />
                <Legend />
                <Line type="linear" dataKey="tests" name="test verdicts" stroke="var(--accent)" strokeWidth={2} connectNulls />
                <Line type="linear" dataKey="monitor" name="real-time monitors" stroke="var(--warn)" strokeWidth={2} strokeDasharray="5 3" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="panel">
          <h2>Time to detect (monitors)</h2>
          {hist.length === 0 ? (
            <Empty>No monitor detections.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={hist} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="bin" stroke="var(--muted)" fontSize={10} />
                <YAxis allowDecimals={false} stroke="var(--muted)" fontSize={11} width={32} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--accent)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Per test</h2>
        <table className="table">
          <thead>
            <tr>
              <th>test</th>
              <th>TP</th>
              <th>FN</th>
              <th>FP</th>
              <th>TN</th>
              <th>recall</th>
              <th>precision</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(card.by_kind).map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v.tp}</td>
                <td>{v.fn}</td>
                <td>{v.fp}</td>
                <td>{v.tn}</td>
                <td>{pct(v.recall, 0)}</td>
                <td>{pct(v.precision, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

const fmtSev = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(3))

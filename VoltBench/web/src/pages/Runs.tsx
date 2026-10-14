import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCreateRunMutation, useGetDevicesQuery, useGetPlansQuery, useGetRunsQuery } from '../api'
import { Empty, ErrorState, Loading } from '../components/common'
import type { Verdict } from '../types'

export default function Runs() {
  const plans = useGetPlansQuery()
  const devices = useGetDevicesQuery()
  const runs = useGetRunsQuery(undefined, { pollingInterval: 3000 })
  const [create, state] = useCreateRunMutation()
  const navigate = useNavigate()
  const [planId, setPlanId] = useState<number | null>(null)
  const [type, setType] = useState('ALL')
  const [picked, setPicked] = useState<Set<number>>(new Set())

  const visible = useMemo(() => (devices.data ?? []).filter((d) => type === 'ALL' || d.type === type), [devices.data, type])
  const plan = plans.data?.find((p) => p.id === (planId ?? plans.data?.[0]?.id))

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const launch = async () => {
    if (!plan || picked.size === 0) return
    const res = await create({ plan_id: plan.id, device_ids: [...picked].sort((a, b) => a - b) })
    if ('data' in res && res.data) navigate(`/runs/${res.data.run_id}`)
  }

  return (
    <section>
      <header className="page-head">
        <h1>Test runs</h1>
      </header>
      <div className="two-col">
        <div className="panel">
          <h2>Launch a run</h2>
          {plans.isLoading && <Loading what="plans" />}
          {plans.error && <ErrorState error={plans.error} retry={plans.refetch} />}
          <div className="row">
            <select value={plan?.id ?? ''} onChange={(e) => setPlanId(Number(e.target.value))} aria-label="Plan">
              {plans.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.tests.length} tests)
                </option>
              ))}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Device type">
              {['ALL', 'BMU', 'BCM', 'TCM'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <button className="btn secondary small" onClick={() => setPicked(new Set(visible.map((d) => d.id)))}>
              Select all
            </button>
            <button className="btn secondary small" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </div>
          {devices.data && visible.length === 0 && <Empty>No devices.</Empty>}
          <div className="chips">
            {visible.map((d) => (
              <label key={d.id} className={`chip ${picked.has(d.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} aria-label={`device ${d.id}`} />
                {d.serial}
              </label>
            ))}
          </div>
          <div className="row">
            <button className="btn" onClick={launch} disabled={picked.size === 0 || !plan || state.isLoading}>
              Launch on {picked.size} device{picked.size === 1 ? '' : 's'}
            </button>
            {state.isError && <span className="bad">Could not start the run.</span>}
          </div>
        </div>
        <div className="panel">
          <h2>Recent runs</h2>
          {runs.isLoading && <Loading what="runs" />}
          {runs.error && <ErrorState error={runs.error} retry={runs.refetch} />}
          {runs.data?.length === 0 && <Empty>No runs yet. Launch one on the left.</Empty>}
          <table className="table">
            <tbody>
              {runs.data?.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/runs/${r.id}`}>#{r.id}</Link>
                  </td>
                  <td>{r.plan}</td>
                  <td>{r.device_ids.length} devices</td>
                  <td>
                    <span className={`badge run-${r.status}`}>{r.status}</span>
                  </td>
                  <td className="verdict-row">
                    {(['PASS', 'FAIL', 'FLAKY', 'ERROR'] as Verdict[]).map(
                      (v) => r.verdicts[v] != null && <span key={v} className={`mini verdict-${v.toLowerCase()}`}>{r.verdicts[v]} {v}</span>,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}


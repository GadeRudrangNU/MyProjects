import { useState } from 'react'
import { useSelector } from 'react-redux'
import { useParams } from 'react-router-dom'
import { useGetAlertsQuery, useGetDeviceQuery, useSendCommandMutation } from '../api'
import { Empty, ErrorState, Loading, StatusBadge } from '../components/common'
import { SignalChart } from '../components/SignalChart'
import { getSeries } from '../live'
import type { RootState } from '../store'
import type { CommandResult } from '../types'
import { useTelemetry } from '../useTelemetry'

const DEFAULT_ARGS: Record<string, string> = {
  SET_OUTPUT: '{"channel": 1, "state": "on"}',
  SET_PUMP_RPM: '{"rpm": 2500}',
  READ_REG: '{"reg": 1}',
}

export default function DeviceDetail() {
  const id = Number(useParams().id)
  const { data, error, isLoading, refetch } = useGetDeviceQuery(id, { pollingInterval: 2000 })
  const alerts = useGetAlertsQuery({ deviceId: id, limit: 30 }, { pollingInterval: 3000 })
  const [showLimits, setShowLimits] = useState(true)
  useTelemetry([id])
  const live = useSelector((s: RootState) => s.live)

  if (isLoading) return <Loading what="device" />
  if (error || !data) return <ErrorState error={error} retry={refetch} />
  const { device, signals, commands } = data

  return (
    <section>
      <header className="page-head">
        <h1>{device.serial}</h1>
        <StatusBadge status={device.status} />
        <span className="muted">
          firmware {device.firmware || '–'} · loss {device.loss_pct.toFixed(1)}% · {device.frames} frames
        </span>
        <span className="spacer" />
        <span className={`badge ${live.connected ? 'status-online' : 'status-offline'}`}>{live.connected ? 'live' : 'disconnected'}</span>
        <label className="check">
          <input type="checkbox" checked={showLimits} onChange={(e) => setShowLimits(e.target.checked)} /> limit bands
        </label>
      </header>

      <div className="latency" data-testid="latency">
        Browser latency (device timestamp to render): p50 {fmt(live.latency.p50)} · p95 {fmt(live.latency.p95)} · p99 {fmt(live.latency.p99)}
        <span className="muted"> ({live.latency.samples} samples)</span>
      </div>

      <div className="grid charts-grid">
        {signals
          .filter((s) => s.monitored)
          .map((s) => (
            <SignalChart key={s.name} signal={s} points={getSeries(id, s.name)} showLimits={showLimits} />
          ))}
      </div>

      <div className="two-col">
        <CommandConsole deviceId={id} commands={commands} />
        <div className="panel">
          <h2>Alerts</h2>
          {alerts.isLoading && <Loading what="alerts" />}
          {alerts.data?.length === 0 && <Empty>No alerts for this device.</Empty>}
          <ul className="feed">
            {alerts.data?.map((a) => (
              <li key={a.id}>
                <span className="muted">{new Date(a.ts).toLocaleTimeString()}</span> <strong>{a.rule}</strong>
                {a.signal && <> on {a.signal}</>}
                {a.value != null && <> ({a.value.toFixed(3)})</>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

const fmt = (v: number | null) => (v == null ? '–' : `${v.toFixed(0)} ms`)

function CommandConsole({ deviceId, commands }: { deviceId: number; commands: string[] }) {
  const [cmd, setCmd] = useState(commands[0])
  const [args, setArgs] = useState(DEFAULT_ARGS[commands[0]] ?? '{}')
  const [send, state] = useSendCommandMutation()
  const [history, setHistory] = useState<{ cmd: string; res: CommandResult | string }[]>([])

  const run = async () => {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(args || '{}')
    } catch {
      setHistory((h) => [{ cmd, res: 'arguments are not valid JSON' }, ...h])
      return
    }
    const result = await send({ id: deviceId, cmd, args: parsed })
    setHistory((h) => [{ cmd, res: 'data' in result && result.data ? result.data : 'command rejected by gateway' }, ...h].slice(0, 8))
  }

  return (
    <div className="panel">
      <h2>Command console</h2>
      <div className="row">
        <select
          value={cmd}
          aria-label="Command"
          onChange={(e) => {
            setCmd(e.target.value)
            setArgs(DEFAULT_ARGS[e.target.value] ?? '{}')
          }}
        >
          {commands.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input value={args} onChange={(e) => setArgs(e.target.value)} aria-label="Arguments" className="mono grow" />
        <button className="btn" onClick={run} disabled={state.isLoading}>
          Send
        </button>
      </div>
      <ul className="feed" data-testid="command-history">
        {history.map((h, i) => (
          <li key={i}>
            <strong>{h.cmd}</strong>{' '}
            {typeof h.res === 'string' ? (
              <span className="bad">{h.res}</span>
            ) : h.res.timed_out ? (
              <span className="bad">no ACK (timed out)</span>
            ) : h.res.nack ? (
              <span className="bad">NACK</span>
            ) : (
              <span className="good">
                ACK in {h.res.latency_ms.toFixed(1)} ms {h.res.data && <span className="muted">{JSON.stringify(h.res.data)}</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

import { useState } from 'react'
import { useClearFaultsMutation, useGetActiveFaultsQuery, useGetDevicesQuery, useGetFaultTypesQuery, useInjectFaultMutation } from '../api'
import { Empty, ErrorState, Loading } from '../components/common'

export default function Lab() {
  const devices = useGetDevicesQuery()
  const types = useGetFaultTypesQuery()
  const active = useGetActiveFaultsQuery(undefined, { pollingInterval: 1500 })
  const [inject, injecting] = useInjectFaultMutation()
  const [clear] = useClearFaultsMutation()
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [type, setType] = useState('drift')
  const [severity, setSeverity] = useState<number | null>(null)
  const [duration, setDuration] = useState(30)

  const device = devices.data?.find((d) => d.id === (deviceId ?? devices.data?.[0]?.id))
  const spec = types.data?.[type]
  const sev = severity ?? spec?.min ?? 1
  const allowed = Object.entries(types.data ?? {}).filter(([, s]) => !device || s.applies.includes(device.type))

  return (
    <section>
      <div className="banner">Test environment: faults injected here break simulated devices on purpose.</div>
      <header className="page-head">
        <h1>Lab</h1>
      </header>
      {(devices.isLoading || types.isLoading) && <Loading what="lab" />}
      {types.error && <ErrorState error={types.error} retry={types.refetch} />}
      <div className="two-col">
        <div className="panel">
          <h2>Inject a fault</h2>
          <div className="form">
            <label>
              Device
              <select value={device?.id ?? ''} onChange={(e) => setDeviceId(Number(e.target.value))} aria-label="Device">
                {devices.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.serial}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fault
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value)
                  setSeverity(null)
                }}
                aria-label="Fault type"
              >
                {allowed.map(([t]) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            {spec && spec.min !== spec.max && (
              <label>
                Severity: {sev} {spec.unit}
                <input
                  type="range"
                  min={spec.min}
                  max={spec.max}
                  step={(spec.max - spec.min) / 100}
                  value={sev}
                  onChange={(e) => setSeverity(Number(e.target.value))}
                  aria-label="Severity"
                />
              </label>
            )}
            <label>
              Duration (s)
              <input type="number" min={5} max={600} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </label>
            <button
              className="btn danger"
              disabled={!device || injecting.isLoading}
              onClick={async () => {
                if (!device) return
                await inject({ device_id: device.id, type, severity: Number(sev.toFixed(4)), duration_s: duration })
                active.refetch()
              }}
            >
              Inject
            </button>
            {injecting.isError && <span className="bad">The lab rejected this fault.</span>}
          </div>
        </div>
        <div className="panel">
          <div className="row">
            <h2>Active faults</h2>
            <button
              className="btn secondary small"
              onClick={async () => {
                await clear()
                active.refetch()
              }}
            >
              Clear all
            </button>
          </div>
          {active.data?.length === 0 && <Empty>No faults active.</Empty>}
          <ul className="feed">
            {active.data?.map((f) => (
              <li key={f.id}>
                device {f.device_id}: <strong>{f.type}</strong> ({f.severity}) for {Math.max(0, Math.round(f.end_at - Date.now() / 1000))}s more
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

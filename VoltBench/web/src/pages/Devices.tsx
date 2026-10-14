import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useGetDevicesQuery } from '../api'
import { Empty, ErrorState, Loading, StatusBadge, ago } from '../components/common'

export default function Devices() {
  const { data, error, isLoading, refetch } = useGetDevicesQuery(undefined, { pollingInterval: 2000 })
  const [type, setType] = useState('ALL')
  const [status, setStatus] = useState('ALL')

  const filtered = useMemo(
    () => (data ?? []).filter((d) => (type === 'ALL' || d.type === type) && (status === 'ALL' || d.status === status)),
    [data, type, status],
  )
  const counts = useMemo(() => {
    const c = { ONLINE: 0, DEGRADED: 0, OFFLINE: 0 }
    for (const d of data ?? []) c[d.status]++
    return c
  }, [data])

  return (
    <section>
      <header className="page-head">
        <h1>Devices</h1>
        <div className="summary">
          <span className="badge status-online">{counts.ONLINE} online</span>
          <span className="badge status-degraded">{counts.DEGRADED} degraded</span>
          <span className="badge status-offline">{counts.OFFLINE} offline</span>
        </div>
        <div className="filters">
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
              {['ALL', 'BMU', 'BCM', 'TCM'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              {['ALL', 'ONLINE', 'DEGRADED', 'OFFLINE'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {isLoading && <Loading what="devices" />}
      {error && <ErrorState error={error} retry={refetch} />}
      {data && filtered.length === 0 && <Empty>No devices match these filters.</Empty>}
      <div className="grid devices-grid">
        {filtered.map((d) => (
          <Link key={d.id} to={`/devices/${d.id}`} className={`card device status-${d.status.toLowerCase()}`} data-testid={`device-${d.id}`}>
            <div className="card-top">
              <strong>{d.serial}</strong>
              <StatusBadge status={d.status} />
            </div>
            <dl>
              <dt>Type</dt>
              <dd>{d.type}</dd>
              <dt>Firmware</dt>
              <dd className={d.firmware && d.firmware !== d.expected_firmware ? 'bad' : ''}>{d.firmware || '–'}</dd>
              <dt>Last seen</dt>
              <dd>{ago(d.last_seen_ms)}</dd>
              <dt>Loss</dt>
              <dd className={d.loss_pct > 2 ? 'bad' : ''}>{d.loss_pct.toFixed(1)}%</dd>
            </dl>
          </Link>
        ))}
      </div>
    </section>
  )
}

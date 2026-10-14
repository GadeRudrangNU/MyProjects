import { BUFFER_POINTS, getSeries, ingest, resetLive, snapshot } from './live'

describe('live telemetry buffers', () => {
  beforeEach(resetLive)

  it('stores points per device and signal', () => {
    ingest({ device_id: 1, ts_ms: 1000, values: { a: 1, b: 2 } }, 1010)
    ingest({ device_id: 2, ts_ms: 1000, values: { a: 9 } }, 1010)
    expect(getSeries(1, 'a')).toEqual([{ t: 1000, v: 1 }])
    expect(getSeries(2, 'a')).toEqual([{ t: 1000, v: 9 }])
    expect(getSeries(1, 'missing')).toEqual([])
  })

  it('caps every series at the buffer size', () => {
    for (let i = 0; i < BUFFER_POINTS + 250; i++) ingest({ device_id: 1, ts_ms: i, values: { a: i } }, i)
    const pts = getSeries(1, 'a')
    expect(pts).toHaveLength(BUFFER_POINTS)
    expect(pts[pts.length - 1].v).toBe(BUFFER_POINTS + 249)
  })

  it('reports end to end latency percentiles', () => {
    for (let i = 1; i <= 100; i++) ingest({ device_id: 1, ts_ms: 0, values: { a: 1 } }, i)
    const { latency, messages } = snapshot()
    expect(messages).toBe(100)
    expect(latency.p50).toBe(50)
    expect(latency.p95).toBe(95)
    expect(latency.p99).toBe(99)
  })
})

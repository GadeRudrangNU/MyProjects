import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { percentile } from './percentile'
import { RingBuffer } from './ringBuffer'

export const BUFFER_POINTS = 600

export interface LatencyStats {
  p50: number | null
  p95: number | null
  p99: number | null
  samples: number
}

interface LiveState {
  connected: boolean
  version: number
  messages: number
  latency: LatencyStats
}

const initialState: LiveState = {
  connected: false,
  version: 0,
  messages: 0,
  latency: { p50: null, p95: null, p99: null, samples: 0 },
}

const slice = createSlice({
  name: 'live',
  initialState,
  reducers: {
    connection(state, action: PayloadAction<boolean>) {
      state.connected = action.payload
    },
    flushed(state, action: PayloadAction<{ messages: number; latency: LatencyStats }>) {
      state.version++
      state.messages = action.payload.messages
      state.latency = action.payload.latency
    },
  },
})

export const { connection, flushed } = slice.actions
export default slice.reducer

export interface SeriesPoint {
  t: number
  v: number
}

// Raw points live outside Redux so a 10 Hz stream does not allocate state per sample.
const series = new Map<string, RingBuffer<SeriesPoint>>()
const latencies = new RingBuffer<number>(BUFFER_POINTS)
let received = 0

const key = (device: number, signal: string) => `${device}/${signal}`

export function getSeries(device: number, signal: string): SeriesPoint[] {
  return series.get(key(device, signal))?.toArray() ?? []
}

export function resetLive() {
  series.clear()
  latencies.clear()
  received = 0
}

export interface WireUpdate {
  device_id: number
  ts_ms: number
  values: Record<string, number>
}

export function ingest(update: WireUpdate, now = Date.now()) {
  received++
  latencies.push(now - update.ts_ms)
  for (const [signal, v] of Object.entries(update.values)) {
    const k = key(update.device_id, signal)
    let buf = series.get(k)
    if (!buf) {
      buf = new RingBuffer<SeriesPoint>(BUFFER_POINTS)
      series.set(k, buf)
    }
    buf.push({ t: update.ts_ms, v })
  }
}

export function snapshot(): { messages: number; latency: LatencyStats } {
  const values = latencies.toArray()
  return {
    messages: received,
    latency: {
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      p99: percentile(values, 99),
      samples: values.length,
    },
  }
}

export type Status = 'ONLINE' | 'DEGRADED' | 'OFFLINE'
export type Verdict = 'PASS' | 'FAIL' | 'ERROR' | 'FLAKY'

export interface Device {
  id: number
  serial: string
  type: 'BMU' | 'BCM' | 'TCM'
  status: Status
  firmware: string
  expected_firmware: string
  last_seen_ms: number
  loss_pct: number
  crc_errors_window: number
  frames: number
  lost: number
  crc_errors: number
  connected: boolean
  values: Record<string, number>
}

export interface Signal {
  id: number
  name: string
  unit: string
  nominal: number
  sigma: number
  range: [number, number]
  hard: [number, number]
  monitored: boolean
}

export interface DeviceDetail {
  device: Device
  signals: Signal[]
  commands: string[]
}

export interface Alert {
  id: number
  device_id: number
  rule: string
  signal: string
  value: number | null
  detail: string
  ts: string
}

export interface Definition {
  id: number
  name: string
  kind: string
  device_type: string
  version: number
  created_at: string
  spec_yaml?: string
}

export interface Plan {
  id: number
  name: string
  tests: { id: number; name: string; kind: string; device_type: string }[]
}

export interface RunSummary {
  id: number
  plan: string
  status: string
  campaign_id: string | null
  device_ids: number[]
  started_at: string | null
  finished_at: string | null
  verdicts: Partial<Record<Verdict, number>>
}

export interface StepLog {
  index: number
  kind: string
  ok: boolean
  ms: number
  detail: string
}

export interface TestResult {
  id: number
  device_id: number
  serial: string
  device_type: string
  test: string
  kind: string
  verdict: Verdict
  attempt: number
  measured: Record<string, unknown>
  limits: Record<string, number | string>
  steps: StepLog[]
  message: string
  started_at: string
  ended_at: string
}

export interface RunDetail {
  run: {
    id: number
    plan: string
    status: string
    device_ids: number[]
    started_at: string | null
    finished_at: string | null
    tests: { id: number; name: string; kind: string; device_type: string }[]
  }
  results: TestResult[]
}

export interface CommandResult {
  ack: boolean
  nack: boolean
  timed_out: boolean
  latency_ms: number
  data?: Record<string, unknown>
}

export interface Point {
  signal: string
  ts: number
  value: number
}

export interface ValidationError {
  line: number
  column: number
  message: string
}

export interface FaultTypeSpec {
  unit: string
  min: number
  max: number
  applies: string[]
}

export interface ActiveFault {
  id: number
  device_id: number
  type: string
  severity: number
  start_at: number
  end_at: number
}

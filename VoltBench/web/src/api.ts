import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type {
  ActiveFault,
  Alert,
  CommandResult,
  Definition,
  Device,
  DeviceDetail,
  FaultTypeSpec,
  Plan,
  Point,
  RunDetail,
  RunSummary,
  ValidationError,
} from './types'

export interface Confusion {
  tp: number
  fn: number
  fp: number
  tn: number
  precision: number | null
  recall: number | null
  f1: number | null
  false_alarm_rate: number | null
}

export interface SeverityBucket {
  lo: number
  hi: number
  n: number
  test_rate: number | null
  monitor_rate: number | null
}

export interface Scorecard {
  campaign_id: string
  created_at: string
  config: { devices: number; runs: number; seed: number; plan: string; clean_fraction: number }
  totals: Record<string, number>
  overall: Confusion
  rates: {
    flaky_rate: number | null
    error_rate: number | null
    fault_coverage: string
    device_level_detection: number | null
  }
  targets: Record<string, number>
  by_kind: Record<string, Confusion>
  by_fault_type: Record<string, { injected: number; tp: number; fn: number; recall: number | null }>
  severity_curve: Record<string, SeverityBucket[]>
  monitor: {
    detection_rate: number | null
    false_alarm_rate: number | null
    clean_device_runs: number
    mttd_s: { n: number; mean: number | null; median: number | null; p95: number | null }
    mttd_histogram: { lo: number; hi: number; count: number }[]
    by_fault_type: Record<string, { injected: number; detected: number; mttd: { median: number | null } }>
  }
  platform: { plan_seconds: { median: number | null; p95: number | null }; devices_per_run: number }
}

export type DefinitionError = { errors?: ValidationError[]; error?: string }

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  tagTypes: ['Definitions', 'Runs'],
  endpoints: (b) => ({
    getDevices: b.query<Device[], void>({ query: () => 'api/devices' }),
    getDevice: b.query<DeviceDetail, number>({ query: (id) => `api/devices/${id}` }),
    getAlerts: b.query<Alert[], { deviceId?: number; limit?: number } | void>({
      query: (a) => `api/alerts?limit=${a?.limit ?? 50}${a?.deviceId ? `&device_id=${a.deviceId}` : ''}`,
    }),
    getTelemetry: b.query<Point[], { id: number; from: number; to: number }>({
      query: ({ id, from, to }) => `api/devices/${id}/telemetry?from=${from}&to=${to}`,
    }),
    sendCommand: b.mutation<CommandResult, { id: number; cmd: string; args: Record<string, unknown> }>({
      query: ({ id, cmd, args }) => ({ url: `api/devices/${id}/commands`, method: 'POST', body: { cmd, args } }),
    }),
    getDefinitions: b.query<Definition[], void>({ query: () => 'api/test-definitions', providesTags: ['Definitions'] }),
    getDefinition: b.query<Definition, number>({ query: (id) => `api/test-definitions/${id}` }),
    createDefinition: b.mutation<{ ok: true; id: number }, string>({
      query: (yaml) => ({
        url: 'api/test-definitions',
        method: 'POST',
        body: yaml,
        headers: { 'Content-Type': 'text/plain' },
      }),
      transformErrorResponse: (res) => res.data as DefinitionError,
      invalidatesTags: ['Definitions'],
    }),
    getPlans: b.query<Plan[], void>({ query: () => 'api/test-plans' }),
    getRuns: b.query<RunSummary[], void>({ query: () => 'api/test-runs', providesTags: ['Runs'] }),
    getRun: b.query<RunDetail, number>({ query: (id) => `api/test-runs/${id}` }),
    createRun: b.mutation<{ run_id: number }, { plan_id: number; device_ids: number[] }>({
      query: (body) => ({ url: 'api/test-runs', method: 'POST', body }),
      invalidatesTags: ['Runs'],
    }),
    getScorecards: b.query<{ campaign_id: string; created_at: string }[], void>({ query: () => 'api/scorecards' }),
    getScorecard: b.query<Scorecard, string>({ query: (id) => `api/scorecards/${id}` }),
    getFaultTypes: b.query<Record<string, FaultTypeSpec>, void>({ query: () => 'lab/fault-types' }),
    getActiveFaults: b.query<ActiveFault[], void>({ query: () => 'lab/faults' }),
    injectFault: b.mutation<unknown, { device_id: number; type: string; severity: number; duration_s: number }>({
      query: (body) => ({ url: 'lab/faults', method: 'POST', body }),
    }),
    clearFaults: b.mutation<unknown, void>({ query: () => ({ url: 'lab/faults', method: 'DELETE' }) }),
  }),
})

export const {
  useGetDevicesQuery,
  useGetDeviceQuery,
  useGetAlertsQuery,
  useGetTelemetryQuery,
  useSendCommandMutation,
  useGetDefinitionsQuery,
  useLazyGetDefinitionQuery,
  useCreateDefinitionMutation,
  useGetPlansQuery,
  useGetRunsQuery,
  useGetRunQuery,
  useCreateRunMutation,
  useGetScorecardsQuery,
  useGetScorecardQuery,
  useGetFaultTypesQuery,
  useGetActiveFaultsQuery,
  useInjectFaultMutation,
  useClearFaultsMutation,
} = api

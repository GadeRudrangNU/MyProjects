import type { Analytics, Rate } from '../types'
import { EmptyState } from './ui'

export function ratio(n: number, d: number): string {
  if (!d) return '—'
  return `${Math.round((n / d) * 1000) / 10}%`
}

function RateRow({ label, r }: { label: string; r: Rate }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{ratio(r.numerator, r.denominator)}</div>
      <div className="text-xs text-slate-600">n = {r.numerator} of {r.denominator}</div>
    </div>
  )
}

function Table({ head, rows, testId }: { head: string[]; rows: (string | number)[][]; testId: string }) {
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-slate-200 text-xs text-slate-600">{head.map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-slate-100">{r.map((c, j) => <td key={j} className="py-1.5 pr-3 tabular-nums text-slate-800">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

export function RatesPanel({ a }: { a: Analytics }) {
  if (!a.sufficient_data) {
    return (
      <div data-testid="insufficient-data">
        <EmptyState title={a.insufficient_message}>
          Conversion rates appear once at least {a.min_applications_for_rates} applications have been recorded. Funnel counts and skill gaps are shown regardless.
        </EmptyState>
      </div>
    )
  }
  const fc = a.fit_conversion
  return (
    <div data-testid="rates">
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <RateRow label="Applied → Assessment" r={a.conversion.assessment_rate} />
        <RateRow label="Applied → Interview" r={a.conversion.interview_rate} />
        <RateRow label="Interview → Offer" r={a.conversion.interview_to_offer_rate} />
      </div>
      <h3 className="mb-1 text-sm font-semibold text-slate-900">High-fit vs. low-fit (threshold {fc.threshold})</h3>
      <Table testId="fit-table" head={['Group', 'Applications', 'Interviews', 'Interview rate']}
        rows={[['High fit', fc.high_fit.applications, fc.high_fit.interviews, ratio(fc.high_fit.interviews, fc.high_fit.applications)],
          ['Low fit', fc.low_fit.applications, fc.low_fit.interviews, ratio(fc.low_fit.interviews, fc.low_fit.applications)]]} />
      {a.score_bands.length > 0 && (<><h3 className="mb-1 mt-5 text-sm font-semibold text-slate-900">Match-score bands</h3>
        <Table testId="band-table" head={['Band', 'Applications', 'Interviews', 'Interview rate']} rows={a.score_bands.map((b) => [b.band, b.applications, b.interviews, ratio(b.interviews, b.applications)])} /></>)}
      {a.role_performance.length > 0 && (<><h3 className="mb-1 mt-5 text-sm font-semibold text-slate-900">Role performance</h3>
        <Table testId="role-table" head={['Role', 'Applications', 'Interviews', 'Offers']} rows={a.role_performance.map((r) => [r.role, r.applications, r.interviews, r.offers])} /></>)}
      {a.resume_version_performance.length > 0 && (<><h3 className="mb-1 mt-5 text-sm font-semibold text-slate-900">Resume versions</h3>
        <Table testId="resume-table" head={['Version', 'Applications', 'Interviews', 'Interview rate']} rows={a.resume_version_performance.map((r) => [r.version, r.applications, r.interviews, ratio(r.interviews, r.applications)])} /></>)}
    </div>
  )
}

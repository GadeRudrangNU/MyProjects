import { formatScore, scoreTone, toneLabel, type ScoreTone } from '../lib/format'

const stroke: Record<ScoreTone, string> = {
  high: '#059669', mid: '#d97706', low: '#dc2626', none: '#94a3b8',
}
const toneGlyph: Record<ScoreTone, string> = { high: '✓', mid: '△', low: '✕', none: '' }

export function MatchRing({ score, size = 56, testId = 'match-score', lowEvidence = false }: { score: number | null | undefined; size?: number; testId?: string; lowEvidence?: boolean }) {
  const tone = lowEvidence && scoreTone(score) === 'high' ? 'mid' : scoreTone(score)
  const label = lowEvidence && tone !== 'none' ? 'Low evidence' : toneLabel[tone]
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  const pct = tone === 'none' ? 0 : Math.max(0, Math.min(100, score as number))
  const big = size >= 90
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}
      role="img" aria-label={tone === 'none' ? 'Match score not available' : `Match score ${formatScore(score)} out of 100, ${label}`} data-testid={testId} data-tone={tone}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={big ? 9 : 6} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke[tone]} strokeWidth={big ? 9 : 6} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={`${big ? 'text-3xl' : 'text-base'} font-semibold text-slate-900`} data-testid={`${testId}-value`}>{formatScore(score)}</span>
        {big && <span className="mt-1 text-[11px] font-medium text-slate-600">{toneGlyph[tone]} {label}</span>}
      </div>
    </div>
  )
}

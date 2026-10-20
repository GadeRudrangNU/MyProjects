import type { SeriesPoint } from "../api";

const width = 560;
const height = 170;
const pad = { left: 38, right: 8, top: 10, bottom: 22 };
const smooth = 5;

type Point = { x: number; y: number | null };

function rates(series: SeriesPoint[], treatment: boolean): (number | null)[] {
  return series.map((_, i) => {
    let requests = 0;
    let errors = 0;
    for (let j = Math.max(0, i - smooth + 1); j <= i; j++) {
      const p = series[j]!;
      requests += treatment ? p.treatmentRequests : p.controlRequests;
      errors += treatment ? p.treatmentErrors : p.controlErrors;
    }
    return requests === 0 ? null : errors / requests;
  });
}

function path(points: Point[], yOf: (v: number) => number): string {
  let d = "";
  let drawing = false;
  for (const p of points) {
    if (p.y === null) {
      drawing = false;
      continue;
    }
    d += `${drawing ? "L" : "M"}${p.x.toFixed(1)} ${yOf(p.y).toFixed(1)} `;
    drawing = true;
  }
  return d.trim();
}

export function ErrorRateChart({ series }: { series: SeriesPoint[] }) {
  const on = rates(series, true);
  const off = rates(series, false);
  const max = Math.max(0.1, ...on.map((v) => v ?? 0), ...off.map((v) => v ?? 0));
  const top = Math.ceil(max * 10) / 10;

  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const xOf = (i: number) => pad.left + (series.length <= 1 ? 0 : (i / (series.length - 1)) * innerW);
  const yOf = (v: number) => pad.top + innerH - (v / top) * innerH;

  const toPoints = (values: (number | null)[]): Point[] => values.map((y, i) => ({ x: xOf(i), y }));
  const ticks = [0, top / 2, top];

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Error rate over the last two minutes">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={yOf(t)} y2={yOf(t)} className="grid" />
            <text x={pad.left - 6} y={yOf(t) + 4} textAnchor="end" className="axis">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        <text x={pad.left} y={height - 5} className="axis">
          2 min ago
        </text>
        <text x={width - pad.right} y={height - 5} textAnchor="end" className="axis">
          now
        </text>
        <path d={path(toPoints(off), yOf)} className="line off" fill="none" />
        <path d={path(toPoints(on), yOf)} className="line on" fill="none" />
      </svg>
      <figcaption>
        <span className="key on" /> New version
        <span className="key off" /> Old version
      </figcaption>
    </figure>
  );
}

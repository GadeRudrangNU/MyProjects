interface TimelineProps {
  data: { month: string; count: number }[];
  alertDate: string;
  recallDate?: string;
}

const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

/** Monthly complaint counts with the alert and (if any) recall report marked. */
export function Timeline({ data, alertDate, recallDate }: TimelineProps) {
  const counts = new Map(data.map((d) => [d.month, d.count]));
  const alertM = alertDate.slice(0, 7);
  const recallM = recallDate?.slice(0, 7);
  const first = data[0].month;
  const last = [data[data.length - 1].month, recallM ?? ""].sort().pop()!;
  const months: string[] = [];
  for (let m = first; m <= last; m = nextMonth(m)) months.push(m);

  const W = 640, H = 170, padL = 28, padB = 22, padT = 14;
  const max = Math.max(...counts.values(), 1);
  const bw = (W - padL) / months.length;
  const x = (m: string) => padL + months.indexOf(m) * bw + bw / 2;
  const tickEvery = Math.ceil(months.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Monthly complaint volume">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} x2={W} y1={padT + (1 - f) * (H - padT - padB)} y2={padT + (1 - f) * (H - padT - padB)} className="grid" />
          <text x={padL - 4} y={padT + (1 - f) * (H - padT - padB) + 3} className="tick" textAnchor="end">
            {Math.round(max * f)}
          </text>
        </g>
      ))}
      {months.map((m, i) => {
        const c = counts.get(m) ?? 0;
        const h = (c / max) * (H - padT - padB);
        return (
          <g key={m}>
            <rect x={padL + i * bw + 1} y={H - padB - h} width={Math.max(bw - 2, 1)} height={h} className={m <= alertM ? "bar" : "bar late"}>
              <title>{`${m}: ${c} complaints`}</title>
            </rect>
            {i % tickEvery === 0 && (
              <text x={x(m)} y={H - 6} className="tick" textAnchor="middle">{m}</text>
            )}
          </g>
        );
      })}
      <line x1={x(alertM)} x2={x(alertM)} y1={padT - 6} y2={H - padB} className="mark alertline" />
      <text x={x(alertM)} y={padT - 4} className="marklabel" textAnchor="middle">alert</text>
      {recallM && (
        <>
          <line x1={x(recallM)} x2={x(recallM)} y1={padT - 6} y2={H - padB} className="mark recallline" />
          <text x={x(recallM)} y={padT - 4} className="marklabel recalltext" textAnchor="middle">recall</text>
        </>
      )}
    </svg>
  );
}

export function Bars({ data }: { data: { bin: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="hbars">
      {data.map((d) => (
        <div key={d.bin} className="hrow">
          <span className="hlabel">{d.bin}</span>
          <span className="htrack">
            <span className="hfill" style={{ width: `${(d.count / max) * 100}%` }} />
          </span>
          <span className="hcount">{d.count}</span>
        </div>
      ))}
    </div>
  );
}

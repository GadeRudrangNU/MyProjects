"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatBytes, type SeriesPoint } from "@bytedrop/shared";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui/card";
import { formatCompact, formatPercent } from "@/lib/utils";

function tickFormatter(series: SeriesPoint[]) {
  const daily = series.length > 1 && new Date(series[1]!.hour).getTime() - new Date(series[0]!.hour).getTime() >= 86_400_000;
  return (iso: string) => {
    const d = new Date(iso);
    return daily
      ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      : `${String(d.getUTCHours()).padStart(2, "0")}:00`;
  };
}

interface PanelProps {
  title: string;
  description: string;
  color: string;
  series: SeriesPoint[];
  value: (p: SeriesPoint) => number;
  format: (n: number) => string;
  kind: "area" | "line";
  domain?: [number, number];
}

function Panel({ title, description, color, series, value, format, kind, domain }: PanelProps) {
  const data = series.map((p) => ({ hour: p.hour, v: value(p) }));
  const fmt = tickFormatter(series);
  const peak = Math.max(...data.map((d) => d.v), 0);
  const common = {
    data,
    margin: { top: 8, right: 12, left: 0, bottom: 0 },
  };
  const axes = (
    <>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="hour" tickFormatter={fmt} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={32} />
      <YAxis tickFormatter={format} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} width={52} domain={domain} />
      <Tooltip
        formatter={(v) => [format(Number(v)), title]}
        labelFormatter={(l) => new Date(String(l)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC"}
        contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
      />
    </>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <figure className="m-0" aria-label={`${title} over time`}>
          <div className="h-56 w-full" role="img" aria-label={`${title} chart with ${data.length} points, peak ${format(peak)}`}>
            <ResponsiveContainer width="100%" height="100%">
              {kind === "area" ? (
                <AreaChart {...common} accessibilityLayer={false}>
                  {axes}
                  <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.14} isAnimationActive={false} />
                </AreaChart>
              ) : (
                <LineChart {...common} accessibilityLayer={false}>
                  {axes}
                  <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
          <figcaption className="sr-only">
            {title}: peak {format(peak)} across {data.length} intervals.
          </figcaption>
        </figure>
      </CardContent>
    </Card>
  );
}

/** Panels mount one after another so the browser never has to render all four charts in a single long task. */
function Staged({ index, shown, children }: { index: number; shown: number; children: React.ReactNode }) {
  return shown > index ? <>{children}</> : <Skeleton className="h-[21.5rem] w-full rounded-xl" />;
}

export function ChartsImpl({ series }: { series: SeriesPoint[] }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= 4) return;
    const t = setTimeout(() => setShown((n) => n + 1), 60);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <section aria-label="Charts" className="grid gap-4 lg:grid-cols-2">
      <Staged index={0} shown={shown}>
        <Panel title="Requests" description="Delivery requests per interval" color="var(--chart-1)" series={series} value={(p) => p.requests} format={formatCompact} kind="area" />
      </Staged>
      <Staged index={1} shown={shown}>
        <Panel title="Bandwidth" description="Bytes sent to clients" color="var(--chart-2)" series={series} value={(p) => p.bandwidth} format={formatBytes} kind="area" />
      </Staged>
      <Staged index={2} shown={shown}>
        <Panel title="Cache hit rate" description="Served without any processing" color="var(--chart-3)" series={series} value={(p) => p.cacheHitRate} format={formatPercent} kind="line" domain={[0, 1]} />
      </Staged>
      <Staged index={3} shown={shown}>
        <Panel title="p95 latency" description="95% of requests finished within" color="var(--chart-4)" series={series} value={(p) => p.p95Ms} format={(n) => `${Math.round(n)} ms`} kind="line" />
      </Staged>
    </section>
  );
}

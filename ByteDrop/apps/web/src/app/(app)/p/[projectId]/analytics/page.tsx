import { Activity, Gauge, HardDriveDownload, Zap } from "lucide-react";
import type { Metadata } from "next";
import { fileKindSchema, formatBytes } from "@bytedrop/shared";
import { AnalyticsFilters } from "@/components/analytics/filters";
import { Charts } from "@/components/analytics/charts-loader";
import { RefreshSummaries } from "@/components/analytics/refresh";
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { guarded, serverApi } from "@/lib/api/server";
import { resolveRange } from "@/lib/analytics-range";
import { formatCompact, formatNumber, formatPercent } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const range = resolveRange({ range: first(sp.range), from: first(sp.from), to: first(sp.to) });
  const kind = fileKindSchema.safeParse(first(sp.kind));
  const bucket = first(sp.bucket);

  const [buckets, data] = await Promise.all([
    guarded(() => serverApi.buckets(projectId)),
    guarded(() => serverApi.analytics(projectId, { from: range.from, to: range.to, bucket, kind: kind.success ? kind.data : undefined })),
  ]);

  const t = data.totals;
  const kpis = [
    { label: "Requests", value: formatNumber(t.requests), icon: Activity },
    { label: "Bandwidth", value: formatBytes(t.bandwidth), icon: HardDriveDownload },
    { label: "Cache hit rate", value: formatPercent(t.cacheHitRate), icon: Zap },
    { label: "p95 latency", value: `${formatNumber(t.p95Ms)} ms`, icon: Gauge },
  ];

  return (
    <main id="main" className="space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Delivery analytics</h1>
          <p className="text-sm text-muted-foreground">{range.label}. Summaries are computed hourly from every delivery request.</p>
        </div>
        <RefreshSummaries projectId={projectId} />
      </div>

      <AnalyticsFilters
        buckets={buckets.map((b) => b.name)}
        value={{ range: range.preset, from: first(sp.from), to: first(sp.to), bucket, kind: kind.success ? kind.data : undefined }}
      />

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>
              </div>
              <Icon aria-hidden className="size-5 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </section>

      {t.requests === 0 ? (
        <EmptyState icon={<Activity />} title="No traffic in this range">
          Requests to your files show up here within a minute. Try a wider date range or remove a filter.
        </EmptyState>
      ) : (
        <>
          <Charts series={data.series} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Top files</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Most requested files</caption>
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="pb-2 font-medium">File</th>
                      <th scope="col" className="pb-2 text-right font-medium">Requests</th>
                      <th scope="col" className="pb-2 text-right font-medium">Bandwidth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topFiles.map((f) => (
                      <tr key={`${f.bucket}/${f.key}`} className="border-t">
                        <td className="max-w-0 truncate py-2 pr-3" title={`${f.bucket}/${f.key}`}>
                          <span className="text-muted-foreground">{f.bucket}/</span>
                          {f.key}
                        </td>
                        <td className="py-2 text-right tabular-nums">{formatCompact(f.requests)}</td>
                        <td className="py-2 text-right tabular-nums">{formatBytes(f.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top referrers</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Sites sending the most requests</caption>
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="pb-2 font-medium">Referrer</th>
                      <th scope="col" className="pb-2 text-right font-medium">Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topReferrers.map((r) => (
                      <tr key={r.referrer} className="border-t">
                        <td className="py-2 pr-3">{r.referrer}</td>
                        <td className="py-2 text-right tabular-nums">{formatCompact(r.requests)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </main>
  );
}

"use client";

import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/form";
import { useUrlState } from "@/components/files/use-url-state";
import { RANGES } from "@/lib/analytics-range";

export function AnalyticsFilters({
  buckets,
  value,
}: {
  buckets: string[];
  value: { range: string; from?: string; to?: string; bucket?: string; kind?: string };
}) {
  const url = useUrlState();
  const custom = value.range === "custom";
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form
      aria-label="Analytics filters"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => e.preventDefault()}
      aria-busy={url.pending}
    >
      <div className="w-44">
        <label htmlFor="range" className="mb-1 block text-xs font-medium text-muted-foreground">
          Date range
        </label>
        <Select
          id="range"
          value={value.range}
          onChange={(e) =>
            e.target.value === "custom"
              ? url.set({ from: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10), to: today, range: undefined })
              : url.set({ range: e.target.value, from: undefined, to: undefined })
          }
        >
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </Select>
      </div>
      {custom ? (
        <>
          <div className="w-40">
            <label htmlFor="from" className="mb-1 block text-xs font-medium text-muted-foreground">
              From
            </label>
            <Input id="from" type="date" max={today} value={value.from ?? ""} onChange={(e) => url.set({ from: e.target.value })} />
          </div>
          <div className="w-40">
            <label htmlFor="to" className="mb-1 block text-xs font-medium text-muted-foreground">
              To
            </label>
            <Input id="to" type="date" max={today} value={value.to ?? ""} onChange={(e) => url.set({ to: e.target.value })} />
          </div>
        </>
      ) : null}
      <div className="w-44">
        <label htmlFor="bucket-filter" className="mb-1 block text-xs font-medium text-muted-foreground">
          Bucket
        </label>
        <Select id="bucket-filter" value={value.bucket ?? ""} onChange={(e) => url.set({ bucket: e.target.value || undefined })}>
          <option value="">All buckets</option>
          {buckets.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-36">
        <label htmlFor="kind-filter" className="mb-1 block text-xs font-medium text-muted-foreground">
          File type
        </label>
        <Select id="kind-filter" value={value.kind ?? ""} onChange={(e) => url.set({ kind: e.target.value || undefined })}>
          <option value="">All types</option>
          <option value="image">Images</option>
          <option value="video">Video</option>
          <option value="audio">Audio</option>
          <option value="pdf">PDF</option>
          <option value="text">Text</option>
          <option value="other">Other</option>
        </Select>
      </div>
    </form>
  );
}

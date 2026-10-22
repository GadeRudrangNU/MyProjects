"use client";

import dynamic from "next/dynamic";
import type { SeriesPoint } from "@bytedrop/shared";
import { Skeleton } from "@/components/ui/card";

const ChartsImpl = dynamic(() => import("./charts").then((m) => m.ChartsImpl), {
  ssr: false,
  loading: () => (
    <div className="grid gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Loading charts">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-72 w-full rounded-xl" />
      ))}
    </div>
  ),
});

/** Recharts is loaded on demand so the page's totals and tables render before the chart code arrives. */
export function Charts({ series }: { series: SeriesPoint[] }) {
  return <ChartsImpl series={series} />;
}

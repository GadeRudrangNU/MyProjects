import type { Metadata } from "next";
import { listObjectsQuery } from "@bytedrop/shared";
import { FileBrowser } from "@/components/files/file-browser";
import { guarded, serverApi } from "@/lib/api/server";

export const metadata: Metadata = { title: "Files" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const parsed = listObjectsQuery.pick({ q: true, sort: true, dir: true, kind: true }).safeParse({
    q: first(sp.q) || undefined,
    sort: first(sp.sort) || undefined,
    dir: first(sp.dir) || undefined,
    kind: first(sp.kind) || undefined,
  });
  const filters = parsed.success ? parsed.data : { sort: "name" as const, dir: "asc" as const };

  const buckets = await guarded(() => serverApi.buckets(projectId));
  const requested = first(sp.bucket);
  const bucket = buckets.find((b) => b.name === requested)?.name ?? buckets[0]?.name ?? null;
  const initial = bucket
    ? await guarded(() => serverApi.objects(projectId, bucket, { ...filters, limit: 200 }))
    : { items: [], nextCursor: null };

  return (
    <main id="main" className="px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Files</h1>
      <FileBrowser
        projectId={projectId}
        buckets={buckets}
        bucket={bucket}
        filters={{ q: filters.q, sort: filters.sort, dir: filters.dir, kind: filters.kind }}
        initialPage={initial}
      />
    </main>
  );
}

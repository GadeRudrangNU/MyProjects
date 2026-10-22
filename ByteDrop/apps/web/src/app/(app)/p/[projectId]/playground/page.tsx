import { ImageIcon } from "lucide-react";
import type { Metadata } from "next";
import { Playground } from "@/components/playground/playground";
import { EmptyState } from "@/components/ui/card";
import { guarded, serverApi } from "@/lib/api/server";

export const metadata: Metadata = { title: "Image transforms" };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function PlaygroundPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const buckets = await guarded(() => serverApi.buckets(projectId));
  // Use the requested bucket, otherwise the first one that actually holds images.
  const requested = buckets.find((b) => b.name === first(sp.bucket));
  const candidates = requested ? [requested] : buckets.filter((b) => b.objectCount > 0).slice(0, 6);
  let bucket = requested?.name ?? buckets[0]?.name;
  let images: Awaited<ReturnType<typeof serverApi.objects>>["items"] = [];
  for (const b of candidates) {
    const page = await guarded(() => serverApi.objects(projectId, b.name, { kind: "image", limit: 100 }));
    if (page.items.length > 0 || requested) {
      bucket = b.name;
      images = page.items;
      break;
    }
  }

  return (
    <main id="main" className="space-y-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Image transforms</h1>
        <p className="text-sm text-muted-foreground">
          Resize and convert on the fly through the delivery URL. Results are cached, so each variant is rendered once.
        </p>
      </div>
      {images.length === 0 || !bucket ? (
        <EmptyState icon={<ImageIcon />} title="No images to transform yet">
          Upload an image to a bucket, then come back to tune its size, quality and format.
        </EmptyState>
      ) : (
        <Playground
          projectId={projectId}
          buckets={buckets.map((b) => b.name)}
          bucket={bucket}
          images={images}
          initialKey={first(sp.key)}
        />
      )}
    </main>
  );
}

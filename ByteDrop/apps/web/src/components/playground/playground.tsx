"use client";

import { useEffect, useMemo, useState } from "react";
import { IMAGE_FORMATS, buildTransformUrl, formatBytes, type ImageFormat, type StoredObject } from "@bytedrop/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Label } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useUrlState } from "@/components/files/use-url-state";
import { useBackendReady } from "@/lib/demo/ready";
import { encodeKeyPath } from "@/lib/utils";

export function Playground({
  projectId: _projectId,
  buckets,
  bucket,
  images,
  initialKey,
}: {
  projectId: string;
  buckets: string[];
  bucket: string;
  images: StoredObject[];
  initialKey?: string;
}) {
  const url = useUrlState();
  const ready = useBackendReady();
  const [key, setKey] = useState(images.find((i) => i.key === initialKey)?.key ?? images[0]!.key);
  const [width, setWidth] = useState(640);
  const [quality, setQuality] = useState(80);
  const [format, setFormat] = useState<ImageFormat | "">("webp");
  const [fit, setFit] = useState<"inside" | "cover" | "contain">("inside");
  const [after, setAfter] = useState<{ bytes: number; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const original = images.find((i) => i.key === key) ?? images[0]!;
  const base = `/f/${bucket}/${encodeKeyPath(original.key)}`;
  const transformed = useMemo(
    () => buildTransformUrl(base, { w: width, q: quality, format: format || undefined, fit: fit === "inside" ? undefined : fit, h: fit === "inside" ? undefined : Math.round(width * 0.66) }),
    [base, width, quality, format, fit],
  );

  // Measure the real response so the saving shown is what a client would download.
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    setAfter(null);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(transformed, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`The server answered ${res.status}`);
        const blob = await res.blob();
        setAfter({ bytes: blob.size, type: res.headers.get("content-type") ?? blob.type });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [transformed, ready]);

  const saving = after ? Math.round((1 - after.bytes / original.size) * 100) : null;
  const absolute = typeof window !== "undefined" ? new URL(transformed, window.location.origin).href : transformed;

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="pg-bucket">Bucket</Label>
            <Select id="pg-bucket" value={bucket} onChange={(e) => url.set({ bucket: e.target.value, key: undefined })}>
              {buckets.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pg-image">Image</Label>
            <Select id="pg-image" value={key} onChange={(e) => setKey(e.target.value)}>
              {images.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.key}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="pg-width">Width</Label>
              <output htmlFor="pg-width" className="text-xs tabular-nums text-muted-foreground">
                {width} px
              </output>
            </div>
            <Slider id="pg-width" aria-label="Width" min={16} max={2000} step={16} value={[width]} onValueChange={([v]) => setWidth(v ?? width)} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="pg-quality">Quality</Label>
              <output htmlFor="pg-quality" className="text-xs tabular-nums text-muted-foreground">
                {quality}
              </output>
            </div>
            <Slider id="pg-quality" aria-label="Quality" min={1} max={100} step={1} value={[quality]} onValueChange={([v]) => setQuality(v ?? quality)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pg-format">Format</Label>
            <Select id="pg-format" value={format} onChange={(e) => setFormat(e.target.value as ImageFormat | "")}>
              <option value="">Keep original</option>
              {IMAGE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pg-fit">Fit</Label>
            <Select id="pg-fit" value={fit} onChange={(e) => setFit(e.target.value as typeof fit)}>
              <option value="inside">Inside (keep ratio)</option>
              <option value="cover">Cover (crop to 3:2)</option>
              <option value="contain">Contain (pad to 3:2)</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Before</CardTitle>
              <p className="text-xs text-muted-foreground">
                {original.contentType} · <span data-testid="size-before">{formatBytes(original.size)}</span>
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid aspect-[3/2] place-items-center overflow-hidden rounded-lg bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ready ? base : undefined} alt={`Original ${original.key}`} className="max-h-full max-w-full object-contain" loading="lazy" />
              </div>
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>After</CardTitle>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {error ? (
                  <span className="text-danger">{error}</span>
                ) : after ? (
                  <>
                    {after.type} · <span data-testid="size-after">{formatBytes(after.bytes)}</span>
                    {saving !== null ? (
                      <span className={saving >= 0 ? " font-medium text-success" : " font-medium text-warning"}>
                        {" "}
                        ({saving >= 0 ? `${saving}% smaller` : `${Math.abs(saving)}% larger`})
                      </span>
                    ) : null}
                  </>
                ) : (
                  "Rendering…"
                )}
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid aspect-[3/2] place-items-center overflow-hidden rounded-lg bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ready ? transformed : undefined} alt={`Transformed ${original.key}`} className="max-h-full max-w-full object-contain" />
              </div>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs" title={absolute} data-testid="transform-url">
              {transformed}
            </code>
            <CopyButton value={absolute} label="Copy URL" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

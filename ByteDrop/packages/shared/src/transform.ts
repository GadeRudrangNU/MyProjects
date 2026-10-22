import { z } from "zod";

export const IMAGE_FORMATS = ["webp", "avif", "jpeg", "png"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const transformQuery = z.object({
  w: z.coerce.number().int().min(1).max(4096).optional(),
  h: z.coerce.number().int().min(1).max(4096).optional(),
  q: z.coerce.number().int().min(1).max(100).default(80),
  format: z.enum(IMAGE_FORMATS).optional(),
  fit: z.enum(["cover", "contain", "inside"]).default("inside"),
});
export type TransformParams = z.infer<typeof transformQuery>;

export function buildTransformUrl(
  base: string,
  p: { w?: number; h?: number; q?: number; format?: ImageFormat; fit?: string },
): string {
  const qs = new URLSearchParams();
  if (p.w) qs.set("w", String(p.w));
  if (p.h) qs.set("h", String(p.h));
  if (p.q && p.q !== 80) qs.set("q", String(p.q));
  if (p.format) qs.set("format", p.format);
  if (p.fit && p.fit !== "inside") qs.set("fit", p.fit);
  const s = qs.toString();
  return s ? `${base}${base.includes("?") ? "&" : "?"}${s}` : base;
}

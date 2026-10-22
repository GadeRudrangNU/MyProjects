import { z } from "zod";
import { BUCKET_NAME_RE, fileKindSchema, idSchema, pageOf, pageQuery } from "./common";

export const projectSchema = z.object({
  id: idSchema,
  name: z.string(),
  quotaBytes: z.number(),
  usedBytes: z.number(),
  createdAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;
export const createProjectSchema = z.object({ name: z.string().trim().min(2).max(60) });

export const scopeSchema = z.enum(["read", "write"]);
export type KeyScope = z.infer<typeof scopeSchema>;

export const apiKeySchema = z.object({
  id: idSchema,
  name: z.string(),
  prefix: z.string(),
  scope: scopeSchema,
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: scopeSchema.default("read"),
});
export const createdApiKeySchema = apiKeySchema.extend({ secret: z.string() });

export const bucketSchema = z.object({
  id: idSchema,
  name: z.string(),
  isPublic: z.boolean(),
  createdAt: z.string(),
  objectCount: z.number(),
  totalBytes: z.number(),
});
export type Bucket = z.infer<typeof bucketSchema>;
export const createBucketSchema = z.object({
  name: z.string().regex(BUCKET_NAME_RE, "3-63 chars: lowercase letters, digits, hyphens"),
  isPublic: z.boolean().default(false),
});

export const objectSchema = z.object({
  key: z.string(),
  size: z.number(),
  contentType: z.string(),
  kind: fileKindSchema,
  etag: z.string(),
  sha256: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StoredObject = z.infer<typeof objectSchema>;
export const objectPageSchema = pageOf(objectSchema);

export const listObjectsQuery = pageQuery.extend({
  prefix: z.string().optional(),
  q: z.string().optional(),
  sort: z.enum(["name", "size", "created"]).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  kind: fileKindSchema.optional(),
});
export type ListObjectsQuery = z.infer<typeof listObjectsQuery>;

export const signLinkSchema = z.object({
  key: z.string().min(1),
  expiresInSeconds: z
    .number()
    .int()
    .min(10)
    .max(60 * 60 * 24 * 30)
    .default(3600),
});
export const signedLinkSchema = z.object({ url: z.string(), expiresAt: z.string() });

export const createUploadSchema = z.object({
  key: z.string().min(1).max(512),
  size: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.string().default("application/octet-stream"),
});
export const uploadSessionSchema = z.object({
  id: idSchema,
  key: z.string(),
  bucket: z.string(),
  size: z.number(),
  offset: z.number(),
  chunkSize: z.number(),
  status: z.enum(["active", "complete", "failed", "cancelled"]),
  expiresAt: z.string(),
  object: objectSchema.nullable(),
});
export type UploadSession = z.infer<typeof uploadSessionSchema>;
export const UPLOAD_CHUNK_SIZE = 1024 * 1024;

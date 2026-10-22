import { z } from "zod";
import {
  analyticsSchema,
  apiKeySchema,
  bucketSchema,
  createdApiKeySchema,
  createdWebhookSchema,
  deliveryPageSchema,
  objectPageSchema,
  projectSchema,
  signedLinkSchema,
  uploadSessionSchema,
  webhookDeliverySchema,
  webhookEndpointSchema,
  type AnalyticsQuery,
  type ListObjectsQuery,
} from "@bytedrop/shared";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface RequestOptions<T> {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
}

export type Requester = <T = undefined>(method: Method, path: string, opts?: RequestOptions<T>) => Promise<T>;

export const meSchema = z.object({ id: z.string(), email: z.string(), name: z.string() });

type Q = Record<string, string | number | undefined>;
const q = (o: object): Q => o as Q;

/** Typed endpoint catalogue. The same definitions run on the server (RSC) and in the browser. */
export function createApi(req: Requester) {
  const p = (id: string) => `/v1/projects/${id}`;
  return {
    me: () => req("GET", "/v1/me", { schema: meSchema }),
    projects: () => req("GET", "/v1/projects", { schema: z.array(projectSchema) }),
    createProject: (name: string) => req("POST", "/v1/projects", { body: { name }, schema: projectSchema }),
    project: (id: string) => req("GET", p(id), { schema: projectSchema }),

    keys: (id: string) => req("GET", `${p(id)}/keys`, { schema: z.array(apiKeySchema) }),
    createKey: (id: string, body: { name: string; scope: "read" | "write" }) =>
      req("POST", `${p(id)}/keys`, { body, schema: createdApiKeySchema }),
    revokeKey: (id: string, keyId: string) => req("DELETE", `${p(id)}/keys/${keyId}`, { schema: apiKeySchema }),

    buckets: (id: string) => req("GET", `${p(id)}/buckets`, { schema: z.array(bucketSchema) }),
    createBucket: (id: string, body: { name: string; isPublic: boolean }) =>
      req("POST", `${p(id)}/buckets`, { body, schema: bucketSchema }),
    deleteBucket: (id: string, bucket: string) => req("DELETE", `${p(id)}/buckets/${bucket}`),

    objects: (id: string, bucket: string, query: Partial<ListObjectsQuery>) =>
      req("GET", `${p(id)}/buckets/${bucket}/objects`, { query: q(query), schema: objectPageSchema }),
    deleteObject: (id: string, bucket: string, key: string) =>
      req("DELETE", `${p(id)}/buckets/${bucket}/objects`, { query: { key } }),
    sign: (id: string, bucket: string, body: { key: string; expiresInSeconds: number }) =>
      req("POST", `${p(id)}/buckets/${bucket}/sign`, { body, schema: signedLinkSchema }),

    analytics: (id: string, query: AnalyticsQuery) =>
      req("GET", `${p(id)}/analytics`, { query: q(query), schema: analyticsSchema }),
    refreshAnalytics: (id: string) =>
      req("POST", `${p(id)}/analytics/refresh`, { schema: z.object({ groups: z.number() }) }),

    webhooks: (id: string) => req("GET", `${p(id)}/webhooks`, { schema: z.array(webhookEndpointSchema) }),
    createWebhook: (id: string, body: { url: string; events: string[] }) =>
      req("POST", `${p(id)}/webhooks`, { body, schema: createdWebhookSchema }),
    deleteWebhook: (id: string, webhookId: string) => req("DELETE", `${p(id)}/webhooks/${webhookId}`),
    deliveries: (id: string, query: { cursor?: string; limit?: number; status?: string }) =>
      req("GET", `${p(id)}/webhooks/deliveries`, { query: q(query), schema: deliveryPageSchema }),
    replay: (id: string, deliveryId: string) =>
      req("POST", `${p(id)}/webhooks/deliveries/${deliveryId}/replay`, { schema: webhookDeliverySchema }),

    createUpload: (
      id: string,
      bucket: string,
      body: { key: string; size: number; sha256: string; contentType: string },
      signal?: AbortSignal,
    ) => req("POST", `${p(id)}/buckets/${bucket}/uploads`, { body, schema: uploadSessionSchema, signal }),
    uploadStatus: (id: string, uploadId: string, signal?: AbortSignal) =>
      req("GET", `${p(id)}/uploads/${uploadId}`, { schema: uploadSessionSchema, signal }),
    cancelUpload: (id: string, uploadId: string) => req("DELETE", `${p(id)}/uploads/${uploadId}`),
  };
}

export type Api = ReturnType<typeof createApi>;

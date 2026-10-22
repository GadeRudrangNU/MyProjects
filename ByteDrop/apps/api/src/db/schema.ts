import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date", precision: 3 });
const big = (name: string) => bigint(name, { mode: "number" });

// ---- Better Auth core tables ----
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---- Product tables ----
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quotaBytes: big("quota_bytes").notNull(),
    usedBytes: big("used_bytes").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("projects_owner_idx").on(t.ownerId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scope: text("scope", { enum: ["read", "write"] }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("api_keys_project_idx").on(t.projectId)],
);

export const buckets = pgTable(
  "buckets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull().unique(),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("buckets_project_idx").on(t.projectId)],
);

export const blobs = pgTable(
  "blobs",
  {
    hash: text("hash").primaryKey(),
    size: big("size").notNull(),
    refCount: integer("ref_count").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    zeroSince: ts("zero_since"),
  },
  (t) => [index("blobs_gc_idx").on(t.zeroSince).where(sql`ref_count = 0`)],
);

export const objects = pgTable(
  "objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucketId: uuid("bucket_id")
      .notNull()
      .references(() => buckets.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    blobHash: text("blob_hash")
      .notNull()
      .references(() => blobs.hash),
    size: big("size").notNull(),
    contentType: text("content_type").notNull(),
    kind: text("kind").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("objects_bucket_key_uq").on(t.bucketId, t.key),
    index("objects_bucket_size_idx").on(t.bucketId, t.size, t.key),
    index("objects_bucket_created_idx").on(t.bucketId, t.createdAt, t.key),
    index("objects_blob_idx").on(t.blobHash),
  ],
);

export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucketId: uuid("bucket_id")
      .notNull()
      .references(() => buckets.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    contentType: text("content_type").notNull(),
    size: big("size").notNull(),
    sha256: text("sha256").notNull(),
    offset: big("offset").notNull().default(0),
    status: text("status", { enum: ["active", "complete", "failed", "cancelled"] })
      .notNull()
      .default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("upload_sessions_status_idx").on(t.status, t.expiresAt)],
);

export const deliveryEvents = pgTable(
  "delivery_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: uuid("project_id").notNull(),
    bucketId: uuid("bucket_id").notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    kind: text("kind").notNull(),
    status: integer("status").notNull(),
    bytes: big("bytes").notNull(),
    cache: text("cache", { enum: ["HIT", "MISS", "REVALIDATED", "BYPASS"] }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    referrer: text("referrer"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("delivery_events_time_idx").on(t.createdAt)],
);

export const analyticsHourly = pgTable(
  "analytics_hourly",
  {
    projectId: uuid("project_id").notNull(),
    bucketId: uuid("bucket_id").notNull(),
    bucket: text("bucket").notNull(),
    kind: text("kind").notNull(),
    hour: ts("hour").notNull(),
    requests: big("requests").notNull(),
    bytes: big("bytes").notNull(),
    cacheHits: big("cache_hits").notNull(),
    cacheMisses: big("cache_misses").notNull(),
    p95Ms: integer("p95_ms").notNull(),
    latencyHist: jsonb("latency_hist").$type<number[]>().notNull(),
    topFiles: jsonb("top_files").$type<Record<string, { requests: number; bytes: number }>>().notNull(),
    topReferrers: jsonb("top_referrers").$type<Record<string, number>>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bucketId, t.kind, t.hour] }),
    index("analytics_hourly_project_idx").on(t.projectId, t.hour),
  ],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events").array().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_project_idx").on(t.projectId)],
);

export const outbox = pgTable(
  "outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: uuid("project_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    trace: jsonb("trace").$type<Record<string, string>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
    dispatchedAt: ts("dispatched_at"),
  },
  (t) => [index("outbox_pending_idx").on(t.id).where(sql`dispatched_at is null`)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    outboxId: big("outbox_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["pending", "success", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastStatusCode: integer("last_status_code"),
    lastResponseMs: integer("last_response_ms"),
    lastError: text("last_error"),
    nextAttemptAt: ts("next_attempt_at"),
    trace: jsonb("trace").$type<Record<string, string>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_project_idx").on(t.projectId, t.createdAt, t.id),
    index("webhook_deliveries_status_idx").on(t.status),
  ],
);

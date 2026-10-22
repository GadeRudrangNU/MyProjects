import type { PgBoss } from "pg-boss";
import { injectTrace, type TraceCarrier } from "../telemetry";

export const Q = {
  thumbnail: "thumbnail.generate",
  gc: "maintenance.gc",
  rollup: "analytics.rollup",
  webhook: "webhook.deliver",
} as const;

export type QueueName = (typeof Q)[keyof typeof Q];

export interface JobData {
  _trace?: TraceCarrier;
  [key: string]: unknown;
}

export async function ensureQueues(boss: PgBoss) {
  await boss.createQueue(Q.thumbnail, { retryLimit: 2, retryDelay: 2 });
  await boss.createQueue(Q.gc, { retryLimit: 1 });
  await boss.createQueue(Q.rollup, { retryLimit: 1 });
  await boss.createQueue(Q.webhook, { retryLimit: 0 });
}

export interface SendOpts {
  startAfter?: Date;
  /** Enqueue inside an existing transaction. */
  db?: { executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };
}

export interface Jobs {
  send(queue: QueueName, data: JobData, opts?: SendOpts): Promise<void>;
}

export function createJobs(boss: PgBoss): Jobs {
  return {
    async send(queue, data, opts) {
      await boss.send(queue, { ...data, _trace: data._trace ?? injectTrace() }, opts ?? {});
    },
  };
}

export const noopJobs: Jobs = { async send() {} };

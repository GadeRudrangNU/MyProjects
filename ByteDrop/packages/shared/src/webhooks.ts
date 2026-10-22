import { z } from "zod";
import { idSchema, pageOf, pageQuery } from "./common";

export const WEBHOOK_EVENTS = ["object.created", "object.deleted", "upload.failed"] as const;
export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const webhookEndpointSchema = z.object({
  id: idSchema,
  url: z.string(),
  events: z.array(webhookEventSchema),
  active: z.boolean(),
  createdAt: z.string(),
});
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;
export const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(webhookEventSchema).min(1).default([...WEBHOOK_EVENTS]),
});
export const createdWebhookSchema = webhookEndpointSchema.extend({ secret: z.string() });

export const deliveryStatusSchema = z.enum(["pending", "success", "failed"]);
export const webhookDeliverySchema = z.object({
  id: idSchema,
  endpointId: idSchema,
  eventType: webhookEventSchema,
  status: deliveryStatusSchema,
  attempts: z.number(),
  lastStatusCode: z.number().nullable(),
  lastResponseMs: z.number().nullable(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
  createdAt: z.string(),
  payload: z.unknown(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
export const deliveryPageSchema = pageOf(webhookDeliverySchema);
export const deliveryQuery = pageQuery.extend({ status: deliveryStatusSchema.optional() });

export const SIGNATURE_HEADER = "bytedrop-signature";

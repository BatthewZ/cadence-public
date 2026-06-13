import { z } from "@hono/zod-openapi";

import { WEBHOOK_EVENT_TYPES } from "../types/webhook";

// ---------------------------------------------------------------------------
// Reusable component schemas (registered in OpenAPI as named components)
// ---------------------------------------------------------------------------

export const webhookResponseSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid().nullable().openapi({
      description:
        "When set, the webhook only fires for events from this project. Null means all workspace events.",
    }),
    name: z.string(),
    url: z.string().url(),
    events: z.string().openapi({
      description: "JSON-encoded array of subscribed event types",
      example: '["task.created","task.updated"]',
    }),
    active: z.boolean(),
    consecutiveFailures: z.number().int(),
    createdAt: z.string().openapi({
      description: "ISO 8601 timestamp",
      example: "2025-01-15T09:30:00.000Z",
    }),
    updatedAt: z.string().openapi({
      description: "ISO 8601 timestamp",
      example: "2025-01-15T09:30:00.000Z",
    }),
  })
  .openapi("Webhook");

export const webhookWithSecretResponseSchema = webhookResponseSchema
  .extend({
    secret: z.string().openapi({
      description:
        "HMAC-SHA256 signing secret (64 hex characters). Only returned on creation or explicit regeneration.",
      example: "a1b2c3d4e5f6...",
    }),
  })
  .openapi("WebhookWithSecret");

export const webhookDeliveryResponseSchema = z
  .object({
    id: z.uuid(),
    webhookId: z.uuid(),
    event: z.string(),
    payload: z.string().openapi({ description: "JSON-encoded payload" }),
    statusCode: z.number().int().nullable(),
    response: z.string().nullable().openapi({
      description: "Response body (truncated to 4096 chars)",
    }),
    success: z.boolean(),
    attempts: z.number().int(),
    maxAttempts: z.number().int(),
    nextRetryAt: z.string().nullable().openapi({
      description: "ISO 8601 timestamp for next retry, or null if completed",
    }),
    createdAt: z.string().openapi({ description: "ISO 8601 timestamp" }),
    lastAttemptAt: z.string().openapi({ description: "ISO 8601 timestamp" }),
  })
  .openapi("WebhookDelivery");

export const testDeliveryResultSchema = z
  .object({
    id: z.uuid(),
    success: z.boolean(),
    statusCode: z.number().int().nullable(),
    response: z.string().nullable(),
  })
  .openapi("TestDeliveryResult");

export const errorResponseSchema = z
  .object({
    error: z.string(),
    requestId: z.string(),
  })
  .openapi("ErrorResponse");

export const validationErrorResponseSchema = z
  .object({
    error: z.literal("Validation failed"),
    details: z.array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    ),
  })
  .openapi("ValidationErrorResponse");

/**
 * Documents the payload shape that webhook subscribers receive when events fire.
 * Not used in request/response validation — registered as a standalone OpenAPI
 * component schema so third-party integrators can see what their endpoints receive.
 */
export const webhookPayloadEnvelopeSchema = z
  .object({
    id: z.uuid().openapi({ description: "Delivery ID" }),
    event: z.enum(WEBHOOK_EVENT_TYPES).openapi({
      description: "The event type that triggered this delivery",
    }),
    timestamp: z.string().openapi({
      description: "ISO 8601 timestamp of when the event occurred",
      example: "2025-01-15T09:30:00.000Z",
    }),
    workspace: z.object({
      id: z.uuid(),
      name: z.string(),
      slug: z.string(),
    }),
    project: z
      .object({
        id: z.uuid(),
        name: z.string(),
      })
      .optional()
      .openapi({ description: "Present for project-scoped events" }),
    actor: z
      .object({
        id: z.uuid(),
        name: z.string(),
        email: z.string().email(),
      })
      .openapi({ description: "The user who triggered the event" }),
    data: z.record(z.string(), z.unknown()).openapi({
      description: "Entity snapshot (task, project, member, etc.)",
    }),
    changes: z
      .record(z.string(), z.object({ from: z.unknown(), to: z.unknown() }))
      .optional()
      .openapi({
        description:
          "Field-level changes for update events. Each key is a field name with before/after values.",
      }),
  })
  .openapi("WebhookPayloadEnvelope");

// ---------------------------------------------------------------------------
// Endpoint response wrappers
// ---------------------------------------------------------------------------

export const createWebhookResponseSchema = z.object({
  webhook: webhookWithSecretResponseSchema,
});

export const listWebhooksResponseSchema = z.object({
  webhooks: z.array(webhookResponseSchema),
});

export const getWebhookResponseSchema = z.object({
  webhook: webhookResponseSchema,
  deliveries: z.array(webhookDeliveryResponseSchema),
});

export const updateWebhookResponseSchema = z.object({
  webhook: webhookResponseSchema,
});

export const testWebhookResponseSchema = z.object({
  delivery: testDeliveryResultSchema.nullable(),
});

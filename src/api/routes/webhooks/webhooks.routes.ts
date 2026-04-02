import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import {
  createWebhookSchema,
  updateWebhookSchema,
} from "../../../shared/schemas/webhook";
import {
  createWebhookResponseSchema,
  errorResponseSchema,
  getWebhookResponseSchema,
  listWebhooksResponseSchema,
  testWebhookResponseSchema,
  updateWebhookResponseSchema,
  validationErrorResponseSchema,
  webhookPayloadEnvelopeSchema,
} from "../../../shared/schemas/webhook-responses";
import type { AppEnv } from "../../env";
import { requireWorkspaceRole } from "../../middleware/authorize";
import { rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validationHook } from "../../middleware/validate";
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhooks,
  testWebhook,
  updateWebhook,
} from "./webhooks.handlers";

// ---------------------------------------------------------------------------
// Reusable param schemas
// ---------------------------------------------------------------------------

const workspaceIdParam = z.object({
  workspaceId: z.string().openapi({
    param: { name: "workspaceId", in: "path" },
    description: "Workspace UUID",
    example: "550e8400-e29b-41d4-a716-446655440000",
  }),
});

const webhookIdParams = workspaceIdParam.extend({
  webhookId: z.string().openapi({
    param: { name: "webhookId", in: "path" },
    description: "Webhook UUID",
    example: "660e8400-e29b-41d4-a716-446655440000",
  }),
});

// ---------------------------------------------------------------------------
// Shared response definitions
// ---------------------------------------------------------------------------

const unauthorizedResponse = {
  content: { "application/json": { schema: errorResponseSchema } },
  description: "Authentication required",
} as const;

const forbiddenResponse = {
  content: { "application/json": { schema: errorResponseSchema } },
  description: "Workspace owner or admin role required",
} as const;

const notFoundResponse = {
  content: { "application/json": { schema: errorResponseSchema } },
  description: "Webhook not found",
} as const;

const rateLimitedResponse = {
  content: { "application/json": { schema: errorResponseSchema } },
  description: "Rate limit exceeded. See Retry-After header.",
} as const;

const authSecurity = [{ bearerAuth: [] }];
const baseAuth = [requireAuth, requireWorkspaceRole("owner", "admin")];
const readMiddleware = [...baseAuth, rateLimit({ max: 60, windowSeconds: 60, prefix: "webhook-read" })];
const writeMiddleware = [...baseAuth, rateLimit({ max: 20, windowSeconds: 60, prefix: "webhook-write" })];
const testMiddleware = [...baseAuth, rateLimit({ max: 5, windowSeconds: 60, prefix: "webhook-test" })];

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const createWebhookRoute = createRoute({
  method: "post",
  path: "/workspaces/{workspaceId}/webhooks",
  tags: ["Webhooks"],
  summary: "Create a webhook",
  description:
    "Create a new webhook subscription. The signing secret is returned only in this response — store it securely. Webhooks are limited to 20 per workspace.",
  security: authSecurity,
  middleware: writeMiddleware,
  request: {
    params: workspaceIdParam,
    body: {
      content: { "application/json": { schema: createWebhookSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: createWebhookResponseSchema } },
      description: "Webhook created successfully. The secret is included in this response only.",
    },
    400: {
      content: { "application/json": { schema: validationErrorResponseSchema } },
      description: "Validation error or invalid webhook URL",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    409: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Maximum webhook limit (20) per workspace exceeded",
    },
    429: rateLimitedResponse,
  },
});

const listWebhooksRoute = createRoute({
  method: "get",
  path: "/workspaces/{workspaceId}/webhooks",
  tags: ["Webhooks"],
  summary: "List webhooks",
  description: "List all webhooks for a workspace. Secrets are never included in list responses.",
  security: authSecurity,
  middleware: readMiddleware,
  request: { params: workspaceIdParam },
  responses: {
    200: {
      content: { "application/json": { schema: listWebhooksResponseSchema } },
      description: "List of webhooks (secrets omitted)",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    429: rateLimitedResponse,
  },
});

const getWebhookRoute = createRoute({
  method: "get",
  path: "/workspaces/{workspaceId}/webhooks/{webhookId}",
  tags: ["Webhooks"],
  summary: "Get webhook with delivery history",
  description:
    "Retrieve a single webhook and its 20 most recent delivery records. The secret is never included.",
  security: authSecurity,
  middleware: readMiddleware,
  request: { params: webhookIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: getWebhookResponseSchema } },
      description: "Webhook details with recent deliveries",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    429: rateLimitedResponse,
  },
});

const updateWebhookRoute = createRoute({
  method: "patch",
  path: "/workspaces/{workspaceId}/webhooks/{webhookId}",
  tags: ["Webhooks"],
  summary: "Update a webhook",
  description:
    "Update webhook configuration. All fields are optional. Set `regenerateSecret: true` to generate a new signing secret — the new secret is returned only in that response. Re-enabling a disabled webhook resets the consecutive failure counter.",
  security: authSecurity,
  middleware: writeMiddleware,
  request: {
    params: webhookIdParams,
    body: {
      content: { "application/json": { schema: updateWebhookSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: updateWebhookResponseSchema } },
      description:
        "Webhook updated. If `regenerateSecret` was true, the response includes the new secret.",
    },
    400: {
      content: { "application/json": { schema: validationErrorResponseSchema } },
      description: "Validation error or invalid webhook URL",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    429: rateLimitedResponse,
  },
});

const deleteWebhookRoute = createRoute({
  method: "delete",
  path: "/workspaces/{workspaceId}/webhooks/{webhookId}",
  tags: ["Webhooks"],
  summary: "Delete a webhook",
  description: "Delete a webhook and all its delivery history.",
  security: authSecurity,
  middleware: writeMiddleware,
  request: { params: webhookIdParams },
  responses: {
    204: { description: "Webhook deleted" },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    429: rateLimitedResponse,
  },
});

const testWebhookRoute = createRoute({
  method: "post",
  path: "/workspaces/{workspaceId}/webhooks/{webhookId}/test",
  tags: ["Webhooks"],
  summary: "Test a webhook",
  description:
    "Send a test delivery to the webhook URL synchronously and return the result. The test event type is `webhook.test`. Rate-limited to 5 requests per minute.",
  security: authSecurity,
  middleware: testMiddleware,
  request: { params: webhookIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: testWebhookResponseSchema } },
      description: "Test delivery result",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    429: rateLimitedResponse,
  },
});

// ---------------------------------------------------------------------------
// Handler adapter
// ---------------------------------------------------------------------------

/**
 * Adapts standalone handler functions (typed as Context<AppEnv>) for use with
 * app.openapi(). The existing handlers return Response objects that satisfy
 * the OpenAPI route's response contract at runtime, but their TypeScript return
 * types are wider than what app.openapi() expects because Hono's c.json()
 * produces a union of all HTTP status codes rather than the specific codes
 * declared in the route definition. The intermediate unknown cast bridges
 * this structural gap between Hono's wide response types and the narrow
 * RouteHandler expectation.
 */
function asRouteHandler<R extends RouteConfig>(
  fn: (c: Context<AppEnv>) => unknown,
): RouteHandler<R, AppEnv> {
  return fn as unknown as RouteHandler<R, AppEnv>;
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});

// Register routes
app.openapi(createWebhookRoute, asRouteHandler<typeof createWebhookRoute>(createWebhook));
app.openapi(listWebhooksRoute, asRouteHandler<typeof listWebhooksRoute>(listWebhooks));
app.openapi(getWebhookRoute, asRouteHandler<typeof getWebhookRoute>(getWebhook));
app.openapi(updateWebhookRoute, asRouteHandler<typeof updateWebhookRoute>(updateWebhook));
app.openapi(deleteWebhookRoute, asRouteHandler<typeof deleteWebhookRoute>(deleteWebhook));
app.openapi(testWebhookRoute, asRouteHandler<typeof testWebhookRoute>(testWebhook));

// Register the webhook payload envelope as a standalone schema for documentation.
// This documents what subscribers receive — it is not tied to any CRUD endpoint.
app.openAPIRegistry.register("WebhookPayloadEnvelope", webhookPayloadEnvelopeSchema);

// Register security scheme
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description:
    "Authentication via session cookie or Authorization header with Bearer token",
});

// OpenAPI spec endpoint — served at /api/openapi.json
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Cadence Webhook API",
    version: "1.0.0",
    description:
      "API for managing webhook subscriptions, viewing delivery history, and testing integrations. " +
      "Webhooks allow you to receive real-time HTTP POST notifications when events occur in your workspace. " +
      "See the WebhookPayloadEnvelope schema for the shape of payloads delivered to your endpoint.",
  },
  servers: [{ url: "/api", description: "Relative API base" }],
});

export default app;

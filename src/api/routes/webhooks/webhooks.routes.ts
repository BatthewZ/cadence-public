import { Hono } from "hono";

import {
  createWebhookSchema,
  updateWebhookSchema,
} from "../../../shared/schemas/webhook";
import type { AppEnv } from "../../env";
import { requireWorkspaceRole } from "../../middleware/authorize";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody } from "../../middleware/validate";
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhooks,
  testWebhook,
  updateWebhook,
} from "./webhooks.handlers";

const app = new Hono<AppEnv>();

// Create webhook
app.post(
  "/workspaces/:workspaceId/webhooks",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  validateBody(createWebhookSchema),
  createWebhook,
);

// List webhooks
app.get(
  "/workspaces/:workspaceId/webhooks",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  listWebhooks,
);

// Get webhook with deliveries
app.get(
  "/workspaces/:workspaceId/webhooks/:webhookId",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  getWebhook,
);

// Update webhook
app.patch(
  "/workspaces/:workspaceId/webhooks/:webhookId",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  validateBody(updateWebhookSchema),
  updateWebhook,
);

// Delete webhook
app.delete(
  "/workspaces/:workspaceId/webhooks/:webhookId",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  deleteWebhook,
);

// Test webhook
app.post(
  "/workspaces/:workspaceId/webhooks/:webhookId/test",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  testWebhook,
);

export default app;

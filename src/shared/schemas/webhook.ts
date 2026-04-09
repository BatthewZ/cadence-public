import { z } from "zod";

import { WEBHOOK_EVENT_TYPES, WORKSPACE_SCOPED_EVENTS } from "../types/webhook";

export const createWebhookSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100),
    url: z.string().url("Must be a valid URL"),
    events: z
      .array(z.enum(WEBHOOK_EVENT_TYPES))
      .min(1, "At least one event is required"),
    projectId: z.string().uuid().optional(),
  })
  .refine(
    (data) => {
      if (!data.projectId) return true;
      return data.events.every((e) => !WORKSPACE_SCOPED_EVENTS.has(e));
    },
    {
      message:
        "Project-scoped webhooks cannot subscribe to workspace or invitation events",
      path: ["events"],
    },
  );

export const updateWebhookSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  url: z.string().url("Must be a valid URL").optional(),
  events: z
    .array(z.enum(WEBHOOK_EVENT_TYPES))
    .min(1, "At least one event is required")
    .optional(),
  active: z.boolean().optional(),
  regenerateSecret: z.boolean().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

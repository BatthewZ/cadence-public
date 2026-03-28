import { z } from "zod";

import { WEBHOOK_EVENT_TYPES } from "../types/webhook";

export const createWebhookSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  url: z.string().url("Must be a valid URL"),
  events: z
    .array(z.enum(WEBHOOK_EVENT_TYPES))
    .min(1, "At least one event is required"),
});

export const updateWebhookSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  url: z.string().url("Must be a valid URL").optional(),
  events: z
    .array(z.enum(WEBHOOK_EVENT_TYPES))
    .min(1, "At least one event is required")
    .optional(),
  active: z.boolean().optional(),
  regenerateSecret: z.boolean().optional(),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

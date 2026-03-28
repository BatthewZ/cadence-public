import { z } from "zod";

import { THEMES } from "../types/theme";

export const updateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"], {
    message: "Invalid role. Allowed values: admin, member",
  }),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  slug: z
    .string()
    .min(2, "URL must be at least 2 characters")
    .max(50)
    .regex(/^[a-z0-9-]+$/, "URL must contain only lowercase letters, numbers, and hyphens"),
  description: z.string().max(500).optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  slug: z
    .string()
    .min(2, "URL must be at least 2 characters")
    .max(50)
    .regex(/^[a-z0-9-]+$/, "URL must contain only lowercase letters, numbers, and hyphens")
    .optional(),
  description: z.string().max(500).optional().nullable(),
  theme: z.enum(THEMES).nullable().optional(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

import { z } from "zod";

import { PROJECT_ROLES, PROJECT_STATUSES } from "../types/roles";
import { THEMES } from "../types/theme";

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(1000).optional(),
  icon: z.string().max(50).optional().nullable(),
  status: z.enum(PROJECT_STATUSES).optional(),
  budget: z.number().int().min(0).nullable().optional(),
  theme: z.enum(THEMES).nullable().optional(),
  autoAssignCreator: z.boolean().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  description: z.string().max(1000).optional().nullable(),
  status: z.enum(PROJECT_STATUSES).optional(),
  icon: z.string().max(50).optional().nullable(),
  coverImageKey: z.string().max(500).optional().nullable(),
  coverImagePosition: z.number().int().min(0).max(100).optional().nullable(),
  theme: z.enum(THEMES).nullable().optional(),
  budget: z.number().int().min(0).nullable().optional(),
  autoAssignCreator: z.boolean().optional(),
});

export const addProjectMemberSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  role: z.enum(PROJECT_ROLES, { message: "Invalid role" }),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;

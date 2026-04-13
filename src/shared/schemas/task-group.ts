import { z } from "zod";

export const createTaskGroupSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex color")
    .optional(),
});

export const updateTaskGroupSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex color")
    .optional()
    .nullable(),
  isCompletionGroup: z.boolean().optional(),
});

export const reorderTaskGroupSchema = z.object({
  position: z.string().min(1, "Position is required"),
});

/**
 * Query schema for the workspace-scoped task-groups endpoint.
 *
 * `projectIds` is a required comma-separated list of project ids. The
 * handler verifies the caller has access to each and returns the groups
 * belonging to those projects. Required (rather than optional) because
 * an unbounded "all groups across all workspace projects" query would be
 * a non-trivial cost and has no current UI consumer.
 */
export const workspaceTaskGroupsQuerySchema = z.object({
  projectIds: z
    .string()
    .min(1, "projectIds is required")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.string().min(1)).min(1).max(100)),
});

export type CreateTaskGroupInput = z.infer<typeof createTaskGroupSchema>;
export type UpdateTaskGroupInput = z.infer<typeof updateTaskGroupSchema>;
export type ReorderTaskGroupInput = z.infer<typeof reorderTaskGroupSchema>;
export type WorkspaceTaskGroupsQuery = z.infer<typeof workspaceTaskGroupsQuerySchema>;

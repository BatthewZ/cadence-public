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

export type CreateTaskGroupInput = z.infer<typeof createTaskGroupSchema>;
export type UpdateTaskGroupInput = z.infer<typeof updateTaskGroupSchema>;
export type ReorderTaskGroupInput = z.infer<typeof reorderTaskGroupSchema>;

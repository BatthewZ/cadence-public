import { z } from "zod";

import { RECURRENCE_FREQUENCIES } from "../types/recurrence";
import { TASK_PRIORITIES } from "../types/roles";

export const recurrenceRuleSchema = z.object({
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.number().int().min(1).max(365),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  nthWeekday: z.object({
    n: z.number().int().min(1).max(5),
    day: z.number().int().min(0).max(6),
  }).optional(),
  endDate: z.string().optional(),
});

export const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000).optional(),
  taskGroupId: z.string().uuid(),
  assigneeId: z.string().min(1).optional().nullable(),
  priority: z.enum(TASK_PRIORITIES).optional().default("none"),
  dueDate: z.string().optional().nullable(),
  cost: z.number().int().min(0).nullable().optional(),
  icon: z.string().max(50).optional().nullable(),
  recurrenceRule: recurrenceRuleSchema.nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  assigneeId: z.string().min(1).optional().nullable(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: z.string().optional().nullable(),
  cost: z.number().int().min(0).nullable().optional(),
  icon: z.string().max(50).optional().nullable(),
  coverImageKey: z.string().max(500).optional().nullable(),
  coverImagePosition: z.number().int().min(0).max(100).optional().nullable(),
  recurrenceRule: recurrenceRuleSchema.nullable().optional(),
});

export const moveTaskSchema = z.object({
  taskGroupId: z.string().uuid(),
  position: z.string().min(1, "Position is required"),
});

export const listActivityQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 5))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z.string().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;
export type RecurrenceRuleInput = z.infer<typeof recurrenceRuleSchema>;

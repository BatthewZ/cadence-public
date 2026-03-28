import { z } from "zod";

export const LABEL_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#6b7280", // gray
  "#78716c", // stone
] as const;

export const MAX_LABELS_PER_PROJECT = 50;
export const MAX_LABELS_PER_TASK = 10;

export const createLabelSchema = z.object({
  name: z.string().min(1).max(30).trim(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const updateLabelSchema = z.object({
  name: z.string().min(1).max(30).trim().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const assignLabelSchema = z.object({
  labelId: z.string().min(1),
});

export type CreateLabelInput = z.infer<typeof createLabelSchema>;
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;
export type AssignLabelInput = z.infer<typeof assignLabelSchema>;

/** Lightweight label info attached to a task (no projectId / timestamps). */
export interface TaskLabelInfo {
  id: string;
  name: string;
  color: string;
}

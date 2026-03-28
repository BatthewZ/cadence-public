import { z } from "zod";

export const myTasksQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 50))
    .pipe(z.number().int().min(1).max(200)),
  cursor: z.string().optional(),
  period: z.enum(["week", "fortnight", "month"]).optional(),
});

export const upcomingTasksQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 50))
    .pipe(z.number().int().min(1).max(200)),
  cursor: z.string().optional(),
});

export const workspaceActivityQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 15))
    .pipe(z.number().int().min(1).max(50)),
  cursor: z.string().optional(),
});

export type MyTasksQuery = z.infer<typeof myTasksQuerySchema>;
export type UpcomingTasksQuery = z.infer<typeof upcomingTasksQuerySchema>;
export type WorkspaceActivityQuery = z.infer<typeof workspaceActivityQuerySchema>;

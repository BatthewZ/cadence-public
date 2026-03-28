import { z } from "zod";

export const createCommentSchema = z.object({
  body: z.string().min(1, "Comment body is required").max(5000),
});

export const updateCommentSchema = z.object({
  body: z.string().min(1, "Comment body is required").max(5000),
});

export const listCommentsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z.string().optional(),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;

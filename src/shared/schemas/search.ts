import { z } from "zod";

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;

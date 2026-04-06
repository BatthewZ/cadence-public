import { z } from "zod";

export const acceptTosSchema = z.object({
  tosVersion: z.string().min(1),
});

export type AcceptTosInput = z.infer<typeof acceptTosSchema>;

import { z } from "zod";

import { WORKSPACE_ROLES } from "../types/roles";

export const createInvitationSchema = z.object({
  email: z.string().email(),
  role: z
    .enum(WORKSPACE_ROLES)
    .refine((val) => val !== "owner", { message: "Cannot invite as owner" })
    .optional(),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

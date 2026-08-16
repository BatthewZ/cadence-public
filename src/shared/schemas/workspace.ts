import { z } from "zod";

import { THEMES } from "../types/theme";
import type { WorkspacePolicy } from "../types/workspace-policy";

export const updateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"], {
    message: "Invalid role. Allowed values: admin, member",
  }),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  slug: z
    .string()
    .min(2, "URL must be at least 2 characters")
    .max(50)
    .regex(/^[a-z0-9-]+$/, "URL must contain only lowercase letters, numbers, and hyphens"),
  description: z.string().max(500).optional(),
});

/**
 * A workspace's governance policy with every toggle present.
 *
 * The `satisfies` clause ties this to the {@link WorkspacePolicy} interface at
 * compile time: adding a toggle there without adding it here is a type error,
 * so the validator cannot fall behind the type it validates.
 */
export const workspacePolicySchema = z
  .object({
    allowMemberProjectCreation: z.boolean(),
  })
  .strict() satisfies z.ZodType<WorkspacePolicy>;

/**
 * A partial update to a workspace's governance policy.
 *
 * Derived from {@link workspacePolicySchema} rather than written out again, so
 * a new toggle becomes patchable automatically instead of being accepted by
 * the full schema and silently rejected by a stale patch schema.
 *
 * Every key optional plus `.strict()` gives PATCH semantics over a closed
 * vocabulary: a client may send only the toggles it means to change, and a
 * misspelled key is a 400 rather than a silently-dropped field that leaves an
 * admin believing they changed a setting they did not.
 */
export const workspacePolicyPatchSchema = workspacePolicySchema.partial();

export type WorkspacePolicyPatch = z.infer<typeof workspacePolicyPatchSchema>;

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  slug: z
    .string()
    .min(2, "URL must be at least 2 characters")
    .max(50)
    .regex(/^[a-z0-9-]+$/, "URL must contain only lowercase letters, numbers, and hyphens")
    .optional(),
  description: z.string().max(500).optional().nullable(),
  theme: z.enum(THEMES).nullable().optional(),
  /**
   * Merged into the stored policy rather than replacing it — see
   * `updateWorkspace` in `src/api/routes/workspaces/workspaces.handlers.ts`
   * for why the merge happens in SQL.
   */
  policy: workspacePolicyPatchSchema.optional(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

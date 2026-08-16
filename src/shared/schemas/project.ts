import { z } from "zod";

import { PROJECT_ROLES, PROJECT_STATUSES } from "../types/roles";
import { THEMES } from "../types/theme";

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(1000).optional(),
  icon: z.string().max(50).optional().nullable(),
  status: z.enum(PROJECT_STATUSES).optional(),
  budget: z.number().int().min(0).nullable().optional(),
  theme: z.enum(THEMES).nullable().optional(),
  autoAssignCreator: z.boolean().optional(),
});

/**
 * Fields a client may change through `PATCH /api/projects/:projectId`.
 *
 * `coverImageKey` and `coverUnsplash` are deliberately ABSENT and must stay
 * absent. `serveUpload` authorizes a `project-cover` download by finding the
 * project whose `cover_image_key` equals the requested key, so a client that
 * could write that column could point its own project at another workspace's
 * R2 object and read it back through its own legitimate access. Nothing outside
 * `api/lib/cover-image.ts` ever writes a non-null `coverImageKey`, and the key
 * it writes is one the server just minted for the caller's own upload — that is
 * what makes the download check an authorization check rather than a lookup.
 *
 * (`coverUnsplash` carries no such authority — it holds absolute Unsplash URLs,
 * not a key into our own storage — so the workspace importer is allowed to
 * restore one from an uploaded export. It nulls `coverImageKey` on the same row,
 * preserving the XOR invariant that `api/lib/cover-image.ts` otherwise owns.)
 *
 * `coverImagePosition` stays here: it is a 0–100 framing offset with no
 * authorization meaning and no bearing on the XOR invariant.
 */
export const updateProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  description: z.string().max(1000).optional().nullable(),
  status: z.enum(PROJECT_STATUSES).optional(),
  icon: z.string().max(50).optional().nullable(),
  coverImagePosition: z.number().int().min(0).max(100).optional().nullable(),
  theme: z.enum(THEMES).nullable().optional(),
  budget: z.number().int().min(0).nullable().optional(),
  autoAssignCreator: z.boolean().optional(),
});

export const duplicateProjectSchema = z.object({
  includeMembers: z.boolean().optional().default(false),
});

export const addProjectMemberSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  role: z.enum(PROJECT_ROLES, { message: "Invalid role" }),
});

/**
 * Body of `PATCH /api/projects/:projectId/members/:userId`.
 *
 * The full `PROJECT_ROLES` set is accepted, unlike the workspace counterpart
 * (`updateMemberRoleSchema`) which excludes `owner`. Projects have no owner
 * tier — every project role is grantable by a project admin — so there is no
 * role here that the schema must hold back from the wire. The rules that *do*
 * constrain a caller (you may not re-role yourself; the row must not have moved
 * under you) are rank- and identity-dependent, so they belong in the handler
 * where the actor is known, not in a static enum.
 */
export const updateProjectMemberRoleSchema = z.object({
  role: z.enum(PROJECT_ROLES, { message: "Invalid role" }),
});

export const reorderProjectSchema = z.object({
  position: z.string().min(1, "Position is required"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type DuplicateProjectInput = z.infer<typeof duplicateProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type UpdateProjectMemberRoleInput = z.infer<typeof updateProjectMemberRoleSchema>;
export type ReorderProjectInput = z.infer<typeof reorderProjectSchema>;

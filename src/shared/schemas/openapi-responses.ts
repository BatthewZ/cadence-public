/**
 * OpenAPI response schemas shared across the documented API surface.
 *
 * These schemas describe the *response shape* of resource endpoints
 * (workspaces, projects, tasks, labels, api-tokens) so the generated
 * OpenAPI spec — and the Scalar UI at `/api/docs` — can render accurate
 * examples and type hints for integrators.
 *
 * Design notes:
 * - Uses `z` from `@hono/zod-openapi` so `.openapi({ description, example })`
 *   metadata flows through to the spec generator.
 * - Schemas mirror the runtime shape returned by the handlers in
 *   `src/api/routes/{workspaces,projects,tasks}/*.handlers.ts`.
 *   Keeping the schema flat (no `infer` on Drizzle table types) means the
 *   spec stays stable when implementation details change.
 * - Dates are serialised as ISO 8601 strings on the wire. JSON.stringify of
 *   a Date does exactly that, so the runtime conforms even when the handler
 *   passes a Date object to `c.json()`.
 * - This file deliberately *only* describes responses for the routes that
 *   Batch 5 D1 documents. Future batches may extend with additional
 *   resources (attachments, teams, invitations, dashboard).
 */

import { z } from "@hono/zod-openapi";

import { PROJECT_ROLES, PROJECT_STATUSES, TASK_PRIORITIES, WORKSPACE_ROLES } from "../types/roles";
import { THEMES } from "../types/theme";
import type { WorkspacePolicy } from "../types/workspace-policy";
import { storedUnsplashCoverPayloadSchema } from "./unsplash";

/**
 * Unsplash cover payload as it appears in project/task responses.
 *
 * Reuses `storedUnsplashCoverPayloadSchema` — the persistence/read variant —
 * so the documented response shape can never drift from what handlers
 * actually store and return. This is deliberately the LENIENT schema (its
 * `rawUrl` is optional), not the strict `PUT .../cover/unsplash` request-body
 * schema: legacy rows written before `rawUrl` existed are returned verbatim,
 * so the response contract must admit a missing `rawUrl` or it would lie
 * about real responses. The DB column is typed `$type<StoredUnsplashCoverPayload>`
 * from this same schema. Nullable because the column is null when the cover
 * source is R2 (or absent); optional because create responses omit cover
 * keys entirely (covers are only attachable after creation via the
 * dedicated cover endpoints).
 */
const coverUnsplashResponseSchema = storedUnsplashCoverPayloadSchema
  .nullable()
  .optional()
  .openapi({
    description:
      "Unsplash cover payload when the cover source is Unsplash. Mutually exclusive with `coverImageKey` (exactly one source is set at a time; both null when no cover).",
  });

// ---------------------------------------------------------------------------
// Shared error / validation schemas (re-exported for convenience)
// ---------------------------------------------------------------------------

export const apiErrorResponseSchema = z
  .object({
    error: z.string().openapi({ description: "Human-readable error message" }),
    requestId: z.string().optional().openapi({
      description: "Correlation id for the failing request. Surface this when filing a support ticket.",
    }),
  })
  .openapi("ApiErrorResponse");

export const apiValidationErrorResponseSchema = z
  .object({
    error: z.literal("Validation failed"),
    details: z.array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    ),
  })
  .openapi("ApiValidationErrorResponse");

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

const isoTimestamp = z.string().openapi({
  description: "ISO 8601 timestamp",
  example: "2025-01-15T09:30:00.000Z",
});

export const workspaceSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    ownerId: z.string(),
    theme: z.enum(THEMES).nullable().optional(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
  .openapi("Workspace");

export const workspaceWithMemberCountSchema = workspaceSchema
  .extend({
    memberCount: z.number().int().nonnegative().openapi({
      description: "Number of members in this workspace",
    }),
    role: z.enum(WORKSPACE_ROLES).optional().openapi({
      description: "The calling user's role inside this workspace. Present only in list responses.",
    }),
  })
  .openapi("WorkspaceWithMemberCount");

export const listWorkspacesResponseSchema = z
  .object({
    workspaces: z.array(workspaceWithMemberCountSchema),
  })
  .openapi("ListWorkspacesResponse");

/**
 * The workspace's governance toggles, always fully populated on the wire.
 *
 * The handler resolves the stored column through `resolveWorkspacePolicy`
 * before responding, so integrators never see a null or a partially-populated
 * object and never need to know this project's defaults to interpret a
 * response. The `satisfies` clause makes adding a toggle to the
 * `WorkspacePolicy` interface a compile error here until the spec describes it
 * too.
 */
export const workspacePolicyResponseSchema = z
  .object({
    allowMemberProjectCreation: z.boolean().openapi({
      description:
        "Whether workspace members (role `member`) may create projects and duplicate projects they administer. Owners and admins always may, regardless of this value. Defaults to true.",
      example: true,
    }),
  })
  .openapi("WorkspacePolicy") satisfies z.ZodType<WorkspacePolicy>;

/**
 * Detail responses carry the policy; list responses do not.
 *
 * That asymmetry is intentional rather than an oversight. The workspace list
 * populates the switcher — it returns a row per workspace the caller belongs
 * to, and shipping every workspace's governance config to render a dropdown is
 * payload nobody reads. The detail endpoint is already a hard dependency of
 * every workspace route (nothing renders until it resolves), so the policy
 * arrives with the data the UI was waiting on anyway, and no screen has to
 * decide what to do about a policy that has not loaded yet.
 */
export const workspaceDetailSchema = workspaceWithMemberCountSchema
  .extend({
    policy: workspacePolicyResponseSchema,
  })
  .openapi("WorkspaceDetail");

export const getWorkspaceResponseSchema = z
  .object({
    workspace: workspaceDetailSchema,
  })
  .openapi("GetWorkspaceResponse");

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const projectSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    status: z.enum(PROJECT_STATUSES),
    budget: z.number().int().nullable(),
    theme: z.enum(THEMES).nullable().optional(),
    autoAssignCreator: z.boolean(),
    coverImageKey: z.string().nullable().optional(),
    coverImagePosition: z.number().int().nullable().optional(),
    coverUnsplash: coverUnsplashResponseSchema,
    position: z.string().nullable().optional().openapi({
      description: "Fractional-index position string used for sort order",
    }),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
  .openapi("Project");

export const projectWithCountsSchema = projectSchema
  .extend({
    memberCount: z.number().int().nonnegative(),
    taskGroupCount: z.number().int().nonnegative(),
  })
  .openapi("ProjectWithCounts");

export const listProjectsResponseSchema = z
  .object({
    projects: z.array(projectWithCountsSchema),
  })
  .openapi("ListProjectsResponse");

export const getProjectResponseSchema = z
  .object({
    project: projectSchema,
  })
  .openapi("GetProjectResponse");

export const createProjectResponseSchema = z
  .object({
    project: projectSchema,
  })
  .openapi("CreateProjectResponse");

export const updateProjectResponseSchema = z
  .object({
    project: projectSchema,
  })
  .openapi("UpdateProjectResponse");

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

const recurrenceRuleResponseSchema = z
  .object({
    frequency: z.string(),
    interval: z.number().int(),
    daysOfWeek: z.array(z.number().int()).optional(),
    dayOfMonth: z.number().int().optional(),
    nthWeekday: z
      .object({ n: z.number().int(), day: z.number().int() })
      .optional(),
    endDate: z.string().optional(),
  })
  .nullable()
  .openapi("TaskRecurrenceRule");

const taskLabelInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
  })
  .openapi("TaskLabelInfo");

export const taskSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    taskGroupId: z.uuid(),
    title: z.string(),
    description: z.string().nullable(),
    assigneeId: z.string().nullable(),
    priority: z.enum(TASK_PRIORITIES),
    completed: z.boolean(),
    completedAt: z.string().nullable(),
    completedBy: z.string().nullable(),
    startDate: z.string().nullable(),
    dueDate: z.string().nullable(),
    cost: z.number().int().nullable(),
    icon: z.string().nullable(),
    coverImageKey: z.string().nullable().optional(),
    coverImagePosition: z.number().int().nullable().optional(),
    coverUnsplash: coverUnsplashResponseSchema,
    recurrenceRule: recurrenceRuleResponseSchema,
    recurrenceSeriesId: z.string().nullable(),
    recurrenceParentId: z.string().nullable(),
    sourceUid: z.string().nullable().openapi({
      description:
        "Provenance UID when the task was created via calendar import (the ICS `UID` of the source event). Null for tasks created any other way. Set only by the import endpoint and immutable thereafter — PATCH ignores it.",
    }),
    position: z.string(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
  .openapi("Task");

export const taskListItemSchema = taskSchema
  .extend({
    assigneeName: z.string().nullable(),
    assigneeAvatarUrl: z.string().nullable(),
    subtaskCount: z.number().int().nonnegative(),
    subtaskCompletedCount: z.number().int().nonnegative(),
    commentCount: z.number().int().nonnegative(),
    attachmentCount: z.number().int().nonnegative(),
    labels: z.array(taskLabelInfoSchema),
  })
  .openapi("TaskListItem");

export const taskDetailSchema = taskSchema
  .extend({
    subtasks: z.array(z.record(z.string(), z.unknown())).openapi({
      description: "Subtask rows; see Subtask schema for shape.",
    }),
    commentCount: z.number().int().nonnegative(),
    labels: z.array(taskLabelInfoSchema),
  })
  .openapi("TaskDetail");

export const listTasksResponseSchema = z
  .object({
    tasks: z.array(taskListItemSchema),
  })
  .openapi("ListTasksResponse");

export const getTaskResponseSchema = z
  .object({
    task: taskDetailSchema,
  })
  .openapi("GetTaskResponse");

export const createTaskResponseSchema = z
  .object({
    task: taskSchema.extend({
      assigneeName: z.string().nullable(),
      assigneeAvatarUrl: z.string().nullable(),
    }),
  })
  .openapi("CreateTaskResponse");

export const updateTaskResponseSchema = z
  .object({
    task: taskSchema,
  })
  .openapi("UpdateTaskResponse");

/**
 * Summary counters returned by `POST /projects/:projectId/tasks/import`.
 *
 * Deliberately NOT the created task rows: a 500-event import would balloon
 * the response, and the client refetches the task list anyway. `skipped`
 * counts events whose `sourceUid` already exists in the project (re-import
 * dedupe); `total` always equals `created + skipped` and echoes the request
 * item count so integrators can detect truncation bugs on their side.
 */
export const importTasksResponseSchema = z
  .object({
    created: z.number().int().nonnegative().openapi({
      description: "Number of tasks inserted by this request.",
    }),
    skipped: z.number().int().nonnegative().openapi({
      description:
        "Number of events skipped because their sourceUid already exists in this project (previously imported).",
    }),
    total: z.number().int().nonnegative().openapi({
      description: "Total events processed (created + skipped).",
    }),
  })
  .openapi("ImportTasksResponse");

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

export const labelSchema = z
  .object({
    id: z.string(),
    projectId: z.uuid(),
    name: z.string(),
    color: z.string().openapi({ description: "Hex color code (e.g. #ef4444)" }),
    createdAt: isoTimestamp,
  })
  .openapi("Label");

export const labelWithCountSchema = labelSchema
  .extend({
    taskCount: z.number().int().nonnegative(),
  })
  .openapi("LabelWithCount");

export const listLabelsResponseSchema = z
  .object({
    labels: z.array(labelWithCountSchema),
  })
  .openapi("ListLabelsResponse");

/**
 * Deduplicated cross-project label option. Carries no `id`/`projectId`
 * because one entry can represent label rows from several projects — the
 * case-insensitive name IS the identity at workspace scope (per-project
 * uniqueness is already case-insensitive, so collapsing on LOWER(name)
 * is lossless for filtering purposes).
 */
export const workspaceLabelSchema = z
  .object({
    name: z.string(),
    color: z.string().openapi({ description: "Hex color code (e.g. #ef4444)" }),
  })
  .openapi("WorkspaceLabel");

export const listWorkspaceLabelsResponseSchema = z
  .object({
    labels: z.array(workspaceLabelSchema),
  })
  .openapi("ListWorkspaceLabelsResponse");

export const createLabelResponseSchema = z
  .object({
    label: labelSchema,
  })
  .openapi("CreateLabelResponse");

export const updateLabelResponseSchema = z
  .object({
    label: labelSchema,
  })
  .openapi("UpdateLabelResponse");

export const deleteLabelResponseSchema = z
  .object({
    ok: z.literal(true),
    deletedId: z.string(),
  })
  .openapi("DeleteLabelResponse");

// ---------------------------------------------------------------------------
// Project membership (used by PROJECT_ROLES export consumers)
// ---------------------------------------------------------------------------

export const projectRoleSchema = z.enum(PROJECT_ROLES).openapi("ProjectRole");

// ---------------------------------------------------------------------------
// API Tokens (Personal Access Tokens)
// ---------------------------------------------------------------------------

export const apiTokenViewSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    workspaceId: z.uuid(),
    name: z.string(),
    tokenPrefix: z.string().openapi({
      description: "First 12 characters of the plaintext (safe to display).",
      example: "cdn_pat_a4kZ",
    }),
    scopes: z.array(z.string()),
    projectScope: z.enum(["all", "selected"]),
    projectIds: z.array(z.string()).nullable(),
    lastUsedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    revokeAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    rotatedToId: z.string().nullable(),
    createdAt: isoTimestamp,
    status: z.enum(["active", "rotating", "expired", "revoked"]).openapi({
      description: "Derived lifecycle status.",
    }),
  })
  .openapi("ApiToken");

export const apiTokenWithPlaintextSchema = apiTokenViewSchema
  .extend({
    plaintext: z.string().openapi({
      description:
        "Plaintext token. Returned ONLY in this response — store it immediately, it cannot be recovered.",
      example: "cdn_pat_a4kZ8x...",
    }),
  })
  .openapi("ApiTokenWithPlaintext");

export const listApiTokensResponseSchema = z
  .object({
    tokens: z.array(apiTokenViewSchema),
  })
  .openapi("ListApiTokensResponse");

export const getApiTokenResponseSchema = z
  .object({
    token: apiTokenViewSchema,
  })
  .openapi("GetApiTokenResponse");

export const createApiTokenResponseSchema = z
  .object({
    token: apiTokenWithPlaintextSchema,
  })
  .openapi("CreateApiTokenResponse");

export const rotateApiTokenResponseSchema = z
  .object({
    token: apiTokenWithPlaintextSchema,
  })
  .openapi("RotateApiTokenResponse");

export const revokeApiTokenResponseSchema = z
  .object({
    ok: z.literal(true),
    alreadyRevoked: z.boolean().optional(),
  })
  .openapi("RevokeApiTokenResponse");

export const createApiTokenRequestSchema = z
  .object({
    name: z.string().min(1).max(100).openapi({
      description: "Human-readable label shown in the UI and audit emails.",
      example: "GitHub Actions deploy",
    }),
    scopes: z.array(z.string().min(1)).min(1).openapi({
      description: "List of scope strings (e.g. `task:read`, `task:write`, `read:*`).",
      example: ["task:read", "task:write"],
    }),
    projectScope: z.enum(["all", "selected"]).openapi({
      description:
        "`all` grants access to every project in the workspace. `selected` restricts to the project IDs in `projectIds`.",
    }),
    projectIds: z.array(z.string().min(1)).max(50).optional().openapi({
      description: "Required when `projectScope` is `selected`. Max 50 entries.",
    }),
    expiresInDays: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .optional()
      .openapi({
        description: "Token lifetime in days. Defaults to 365.",
        example: 365,
      }),
  })
  .openapi("CreateApiTokenRequest");

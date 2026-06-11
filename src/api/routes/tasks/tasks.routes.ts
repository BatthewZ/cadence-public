/**
 * Task + comment + subtask + attachment route registrations.
 *
 * The in-scope endpoints for Batch 5 D1 — list, detail, create, update on
 * tasks — are wired through `app.openapi()` so they appear in the spec.
 * Everything else stays on plain Hono registrations and will be documented
 * in a follow-up pass (comments, subtasks, attachments, completion,
 * activity, cover image, label assignment).
 */

import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { createCommentSchema, listCommentsQuerySchema, updateCommentSchema } from "../../../shared/schemas/comment";
import { assignLabelSchema } from "../../../shared/schemas/label";
import {
  apiErrorResponseSchema,
  apiValidationErrorResponseSchema,
  createTaskResponseSchema,
  getTaskResponseSchema,
  listTasksResponseSchema,
  updateTaskResponseSchema,
} from "../../../shared/schemas/openapi-responses";
import { createSubtaskSchema, updateSubtaskSchema } from "../../../shared/schemas/subtask";
import { createTaskSchema, listActivityQuerySchema, moveTaskSchema, updateTaskSchema } from "../../../shared/schemas/task";
import { unsplashCoverPayloadSchema } from "../../../shared/schemas/unsplash";
import type { AppEnv } from "../../env";
import {
  requireProjectAccess,
  requireProjectRole,
  requireReadScopeForResource,
  requireTaskAccess,
  requireTaskRole,
  requireWriteScopeForResource,
} from "../../middleware/authorize";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody, validateQuery, validationHook } from "../../middleware/validate";
import { deleteAttachment, listAttachments, uploadAttachment } from "./attachments.handlers";
import { assignLabel, unassignLabel } from "./labels.handlers";
import {
  applyTaskUnsplashCover,
  completeTask,
  createComment,
  createSubtask,
  createTask,
  deleteComment,
  deleteSubtask,
  deleteTask,
  deleteTaskCover,
  duplicateTask,
  getTask,
  getTaskActivity,
  listComments,
  listTasks,
  moveTask,
  uncompleteTask,
  updateComment,
  updateSubtask,
  updateTask,
  uploadTaskCover,
} from "./tasks.handlers";

/**
 * Bridge between Hono's wide `Context<AppEnv>` handler return type and the
 * narrow `RouteHandler<R, AppEnv>` that `app.openapi()` expects.
 */
function asRouteHandler<R extends RouteConfig>(
  fn: (c: Context<AppEnv>) => unknown,
): RouteHandler<R, AppEnv> {
  return fn as unknown as RouteHandler<R, AppEnv>;
}

// ---------------------------------------------------------------------------
// Shared param + response definitions
// ---------------------------------------------------------------------------

const projectIdParam = z.object({
  projectId: z.string().openapi({
    param: { name: "projectId", in: "path" },
    description: "Project UUID",
    example: "660e8400-e29b-41d4-a716-446655440000",
  }),
});

const taskIdParam = z.object({
  taskId: z.string().openapi({
    param: { name: "taskId", in: "path" },
    description: "Task UUID",
    example: "770e8400-e29b-41d4-a716-446655440000",
  }),
});

const listTasksQuerySchema = z.object({
  taskGroupId: z.string().optional().openapi({
    param: { name: "taskGroupId", in: "query" },
    description: "Filter to tasks in this task group only",
  }),
  assigneeId: z.string().optional().openapi({
    param: { name: "assigneeId", in: "query" },
    description: "Filter to tasks assigned to this user",
  }),
  completed: z.enum(["true", "false"]).optional().openapi({
    param: { name: "completed", in: "query" },
    description: "Filter by completion status",
  }),
  priority: z.string().optional().openapi({
    param: { name: "priority", in: "query" },
    description: "Filter by priority (urgent | high | medium | low | none)",
  }),
  labelId: z.string().optional().openapi({
    param: { name: "labelId", in: "query" },
    description: "Comma-separated list of label IDs; tasks matching any are returned",
  }),
});

const unauthorizedResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Authentication required",
} as const;

const forbiddenResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Caller lacks the required project/task role",
} as const;

const taskNotFoundResponse = {
  content: { "application/json": { schema: apiErrorResponseSchema } },
  description: "Task not found",
} as const;

const validationFailedResponse = {
  content: { "application/json": { schema: apiValidationErrorResponseSchema } },
  description: "Validation failed",
} as const;

const security: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { cookieAuth: [] }];

// ---------------------------------------------------------------------------
// Task route definitions
// ---------------------------------------------------------------------------

const listTasksRoute = createRoute({
  method: "get",
  path: "/projects/{projectId}/tasks",
  tags: ["Tasks"],
  summary: "List tasks in a project",
  description:
    "Returns every task in the project, enriched with subtask/comment/attachment counts and assigned labels. Query params filter the result set in SQL (no client-side filtering needed).",
  security,
  middleware: [requireAuth, requireProjectAccess()],
  request: {
    params: projectIdParam,
    query: listTasksQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: listTasksResponseSchema } },
      description: "List of tasks",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const getTaskRoute = createRoute({
  method: "get",
  path: "/tasks/{taskId}",
  tags: ["Tasks"],
  summary: "Get a task",
  description:
    "Returns a single task with its subtasks, label assignments, and a count of comments. Caller must have project access derived from the task.",
  security,
  middleware: [requireAuth, requireTaskAccess()],
  request: {
    params: taskIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: getTaskResponseSchema } },
      description: "Task details",
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: taskNotFoundResponse,
  },
});

const createTaskRoute = createRoute({
  method: "post",
  path: "/projects/{projectId}/tasks",
  tags: ["Tasks"],
  summary: "Create a task",
  description:
    "Create a new task inside a project. If the target task group is a completion group the task is marked completed on creation. When `recurrenceRule` is set but `dueDate` is omitted, today is used as the first occurrence.",
  security,
  middleware: [requireAuth, requireProjectRole("admin", "member")],
  request: {
    params: projectIdParam,
    body: {
      content: { "application/json": { schema: createTaskSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: createTaskResponseSchema } },
      description: "Task created",
    },
    400: validationFailedResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: {
      content: { "application/json": { schema: apiErrorResponseSchema } },
      description: "Task group not found in this project",
    },
  },
});

const updateTaskRoute = createRoute({
  method: "patch",
  path: "/tasks/{taskId}",
  tags: ["Tasks"],
  summary: "Update a task",
  description:
    "Partial-update a task. Only fields included in the body are written; activity entries are logged per changed field. Webhook events are dispatched for `task.updated` and any derived events (e.g. `task.completed`, `task.assigned`).",
  security,
  middleware: [requireAuth, requireTaskRole("admin", "member")],
  request: {
    params: taskIdParam,
    body: {
      content: { "application/json": { schema: updateTaskSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: updateTaskResponseSchema } },
      description: "Task updated",
    },
    400: validationFailedResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: taskNotFoundResponse,
  },
});

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});

// ---------------------------------------------------------------------------
// PAT scope enforcement
// ---------------------------------------------------------------------------
//
// Task / attachment / label scopes are mounted per exact path because the
// doc's scope grammar treats labels and attachments as first-class even
// when they live under a task URL. Cover image routes and subtasks /
// comments are task-internal so they fall under `task:write` — there is no
// `comment:*` or `subtask:*` scope in the v1 grammar.
//
// `task:delete` is a separate heightened scope (`allowDelete: true`) so
// destructive operations require explicit grant rather than being implied
// by `task:write` or `write:*`.
const taskReadScope = requireReadScopeForResource("task");
const taskWriteScope = requireWriteScopeForResource({ resource: "task", allowDelete: true });
const labelWriteScope = requireWriteScopeForResource({ resource: "label" });
const attachmentReadScope = requireReadScopeForResource("attachment");
const attachmentWriteScope = requireWriteScopeForResource({ resource: "attachment" });

// Task collection + individual task ops
app.use("/projects/:projectId/tasks", taskReadScope, taskWriteScope);
app.use("/tasks/:taskId", taskReadScope, taskWriteScope);
app.use("/tasks/:taskId/move", taskReadScope, taskWriteScope);
app.use("/tasks/:taskId/duplicate", taskReadScope, taskWriteScope);
app.use("/tasks/:taskId/complete", taskReadScope, taskWriteScope);
app.use("/tasks/:taskId/uncomplete", taskReadScope, taskWriteScope);
app.use("/tasks/:taskId/activity", taskReadScope, taskWriteScope);
app.use("/tasks/:taskId/cover", taskReadScope, taskWriteScope);
app.use("/tasks/:taskId/cover/unsplash", taskReadScope, taskWriteScope);

// Subtasks + comments are task-internal — covered by `task:*`.
app.use("/tasks/:taskId/subtasks", taskReadScope, taskWriteScope);
app.use("/subtasks/:subtaskId", taskReadScope, taskWriteScope);
app.use("/tasks/:taskId/comments", taskReadScope, taskWriteScope);
app.use("/comments/:commentId", taskReadScope, taskWriteScope);

// Attachments have their own scope per the doc.
app.use("/tasks/:taskId/attachments", attachmentReadScope, attachmentWriteScope);
app.use("/tasks/:taskId/attachments/:attachmentId", attachmentReadScope, attachmentWriteScope);

// Label assignment on a task is a label operation per the doc grammar.
// We use `labelWriteScope` for both POST and DELETE — assigning/removing
// labels is a label-write action, not a label-delete (deletion of the
// label itself is in projects.routes.ts).
app.use("/tasks/:taskId/labels", labelWriteScope);
app.use("/tasks/:taskId/labels/:labelId", labelWriteScope);

// Documented routes
app.openapi(listTasksRoute, asRouteHandler<typeof listTasksRoute>(listTasks));
app.openapi(getTaskRoute, asRouteHandler<typeof getTaskRoute>(getTask));
app.openapi(createTaskRoute, asRouteHandler<typeof createTaskRoute>(createTask));
app.openapi(updateTaskRoute, asRouteHandler<typeof updateTaskRoute>(updateTask));

// ---------------------------------------------------------------------------
// Remaining plain-Hono routes (not yet documented)
// ---------------------------------------------------------------------------

app.delete(
  "/tasks/:taskId",
  requireAuth,
  requireTaskRole("admin", "member"),
  deleteTask,
);

app.patch(
  "/tasks/:taskId/move",
  requireAuth,
  requireTaskRole("admin", "member"),
  validateBody(moveTaskSchema),
  moveTask,
);

app.post(
  "/tasks/:taskId/duplicate",
  requireAuth,
  requireTaskRole("admin", "member"),
  duplicateTask,
);

// ---------------------------------------------------------------------------
// Task completion routes
// ---------------------------------------------------------------------------

app.post(
  "/tasks/:taskId/complete",
  requireAuth,
  requireTaskRole("admin", "member"),
  completeTask,
);

app.post(
  "/tasks/:taskId/uncomplete",
  requireAuth,
  requireTaskRole("admin", "member"),
  uncompleteTask,
);

// ---------------------------------------------------------------------------
// Task activity routes
// ---------------------------------------------------------------------------

app.get(
  "/tasks/:taskId/activity",
  requireAuth,
  requireTaskAccess(),
  validateQuery(listActivityQuerySchema),
  getTaskActivity,
);

// ---------------------------------------------------------------------------
// Task cover image routes
// ---------------------------------------------------------------------------

app.put(
  "/tasks/:taskId/cover",
  requireAuth,
  requireTaskRole("admin", "member"),
  rateLimit({ max: 10, windowSeconds: 60, prefix: "task-cover-upload", keyFn: defaultRateLimitKey }),
  uploadTaskCover,
);

app.put(
  "/tasks/:taskId/cover/unsplash",
  requireAuth,
  requireTaskRole("admin", "member"),
  rateLimit({ max: 10, windowSeconds: 60, prefix: "task-cover-unsplash", keyFn: defaultRateLimitKey }),
  validateBody(unsplashCoverPayloadSchema),
  applyTaskUnsplashCover,
);

app.delete(
  "/tasks/:taskId/cover",
  requireAuth,
  requireTaskRole("admin", "member"),
  deleteTaskCover,
);

// ---------------------------------------------------------------------------
// Subtask routes
// ---------------------------------------------------------------------------

app.post(
  "/tasks/:taskId/subtasks",
  requireAuth,
  requireTaskRole("admin", "member"),
  validateBody(createSubtaskSchema),
  createSubtask,
);

// Subtask PATCH/DELETE resolve the parent task's project and check access
// inline in handlers (no taskId in URL to use requireTaskAccess middleware).
app.patch(
  "/subtasks/:subtaskId",
  requireAuth,
  validateBody(updateSubtaskSchema),
  updateSubtask,
);

app.delete(
  "/subtasks/:subtaskId",
  requireAuth,
  deleteSubtask,
);

// ---------------------------------------------------------------------------
// Comment routes
// ---------------------------------------------------------------------------

app.get(
  "/tasks/:taskId/comments",
  requireAuth,
  requireTaskAccess(),
  validateQuery(listCommentsQuerySchema),
  listComments,
);

app.post(
  "/tasks/:taskId/comments",
  requireAuth,
  requireTaskRole("admin", "member"),
  validateBody(createCommentSchema),
  createComment,
);

// Comment PATCH/DELETE resolve the parent task's project and check access
// inline in handlers (no taskId in URL to use requireTaskAccess middleware).
app.patch(
  "/comments/:commentId",
  requireAuth,
  validateBody(updateCommentSchema),
  updateComment,
);

app.delete(
  "/comments/:commentId",
  requireAuth,
  deleteComment,
);

// ---------------------------------------------------------------------------
// Task attachment routes
// ---------------------------------------------------------------------------

app.get(
  "/tasks/:taskId/attachments",
  requireAuth,
  requireTaskAccess(),
  listAttachments,
);

app.post(
  "/tasks/:taskId/attachments",
  requireAuth,
  requireTaskRole("admin", "member"),
  rateLimit({ max: 20, windowSeconds: 60, prefix: "task-attachment-upload", keyFn: defaultRateLimitKey }),
  uploadAttachment,
);

app.delete(
  "/tasks/:taskId/attachments/:attachmentId",
  requireAuth,
  requireTaskAccess(),
  deleteAttachment,
);

// ---------------------------------------------------------------------------
// Task label routes
// ---------------------------------------------------------------------------

app.post(
  "/tasks/:taskId/labels",
  requireAuth,
  requireTaskRole("admin", "member"),
  validateBody(assignLabelSchema),
  assignLabel,
);

app.delete(
  "/tasks/:taskId/labels/:labelId",
  requireAuth,
  requireTaskRole("admin", "member"),
  unassignLabel,
);

export default app;

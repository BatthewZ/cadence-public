import { Hono } from "hono";

import { createCommentSchema, listCommentsQuerySchema, updateCommentSchema } from "../../../shared/schemas/comment";
import { assignLabelSchema } from "../../../shared/schemas/label";
import { createSubtaskSchema, updateSubtaskSchema } from "../../../shared/schemas/subtask";
import { createTaskSchema, listActivityQuerySchema, moveTaskSchema, updateTaskSchema } from "../../../shared/schemas/task";
import type { AppEnv } from "../../env";
import {
  requireProjectAccess,
  requireProjectRole,
  requireTaskAccess,
  requireTaskRole,
} from "../../middleware/authorize";
import { rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody, validateQuery } from "../../middleware/validate";
import { deleteAttachment, listAttachments, uploadAttachment } from "./attachments.handlers";
import { assignLabel, unassignLabel } from "./labels.handlers";
import {
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

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Task routes (project-scoped)
// ---------------------------------------------------------------------------

app.post(
  "/projects/:projectId/tasks",
  requireAuth,
  requireProjectRole("admin", "member"),
  validateBody(createTaskSchema),
  createTask,
);

app.get(
  "/projects/:projectId/tasks",
  requireAuth,
  requireProjectAccess(),
  listTasks,
);

// ---------------------------------------------------------------------------
// Task routes (task-scoped — requireTaskAccess resolves project from task)
// ---------------------------------------------------------------------------

app.get(
  "/tasks/:taskId",
  requireAuth,
  requireTaskAccess(),
  getTask,
);

app.patch(
  "/tasks/:taskId",
  requireAuth,
  requireTaskRole("admin", "member"),
  validateBody(updateTaskSchema),
  updateTask,
);

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
  rateLimit({ max: 10, windowSeconds: 60, prefix: "task-cover-upload" }),
  uploadTaskCover,
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
  rateLimit({ max: 20, windowSeconds: 60, prefix: "task-attachment-upload" }),
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

import { Hono } from "hono";

import {
  createTaskGroupSchema,
  reorderTaskGroupSchema,
  updateTaskGroupSchema,
} from "../../../shared/schemas/task-group";
import type { AppEnv } from "../../env";
import {
  requireProjectAccess,
  requireProjectRole,
} from "../../middleware/authorize";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody } from "../../middleware/validate";
import {
  createTaskGroup,
  deleteTaskGroup,
  listTaskGroups,
  reorderTaskGroup,
  updateTaskGroup,
} from "./task-groups.handlers";

const app = new Hono<AppEnv>();

// Project-scoped routes (projectId in URL, middleware resolves access)
app.post(
  "/projects/:projectId/task-groups",
  requireAuth,
  requireProjectRole("admin", "member"),
  validateBody(createTaskGroupSchema),
  createTaskGroup,
);

app.get(
  "/projects/:projectId/task-groups",
  requireAuth,
  requireProjectAccess(),
  listTaskGroups,
);

// Task-group-scoped routes — no projectId in URL, so access is resolved
// inline in handlers via resolveTaskGroupWithAccess (looks up the parent
// project and delegates to resolveProjectAccess).
app.patch(
  "/task-groups/:taskGroupId",
  requireAuth,
  validateBody(updateTaskGroupSchema),
  updateTaskGroup,
);

app.delete(
  "/task-groups/:taskGroupId",
  requireAuth,
  deleteTaskGroup,
);

app.patch(
  "/task-groups/:taskGroupId/reorder",
  requireAuth,
  validateBody(reorderTaskGroupSchema),
  reorderTaskGroup,
);

export default app;

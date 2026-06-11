import { Hono } from "hono";

import {
  createTaskGroupSchema,
  reorderTaskGroupSchema,
  updateTaskGroupSchema,
  workspaceTaskGroupsQuerySchema,
} from "../../../shared/schemas/task-group";
import type { AppEnv } from "../../env";
import {
  requireProjectAccess,
  requireProjectRole,
  requireReadScopeForResource,
  requireWorkspaceMember,
  requireWriteScopeForResource,
} from "../../middleware/authorize";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody, validateQuery } from "../../middleware/validate";
import {
  createTaskGroup,
  deleteTaskGroup,
  listTaskGroups,
  listWorkspaceTaskGroups,
  reorderTaskGroup,
  updateTaskGroup,
} from "./task-groups.handlers";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// PAT scope enforcement
// ---------------------------------------------------------------------------
//
// Task groups organise tasks within a project — they have no dedicated
// scope in the doc's grammar, so they fall under `task:*`. A PAT with
// `task:write` can rearrange task groups (which is functionally a task
// organisation change). `allowDelete: true` because DELETE on a task
// group is a destructive operation that maps to `task:delete` for
// consistency with task deletion.
const taskReadScope = requireReadScopeForResource("task");
const taskWriteScope = requireWriteScopeForResource({ resource: "task", allowDelete: true });

app.use("/projects/:projectId/task-groups", taskReadScope, taskWriteScope);
app.use("/workspaces/:workspaceId/task-groups", taskReadScope, taskWriteScope);
app.use("/task-groups/:taskGroupId", taskReadScope, taskWriteScope);
app.use("/task-groups/:taskGroupId/reorder", taskReadScope, taskWriteScope);

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

app.get(
  "/workspaces/:workspaceId/task-groups",
  requireAuth,
  requireWorkspaceMember(),
  validateQuery(workspaceTaskGroupsQuerySchema),
  listWorkspaceTaskGroups,
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

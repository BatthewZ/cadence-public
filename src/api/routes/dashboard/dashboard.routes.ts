import { Hono } from "hono";

import { myTasksQuerySchema, upcomingTasksQuerySchema, workspaceActivityQuerySchema } from "../../../shared/schemas/dashboard";
import type { AppEnv } from "../../env";
import {
  requireProjectAccess,
  requireReadScopeForResource,
  requireWorkspaceMember,
} from "../../middleware/authorize";
import { requireAuth } from "../../middleware/require-auth";
import { validateQuery } from "../../middleware/validate";
import {
  myTasks,
  projectActivity,
  projectDashboard,
  upcomingTasks,
  workspaceActivity,
  workspaceDashboard,
} from "./dashboard.handlers";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// PAT scope enforcement
// ---------------------------------------------------------------------------
//
// Every route here is a cross-project aggregate read, and until this block
// existed none of them carried a capability-scope check at all — a PAT minted
// with a single unrelated scope (`team:read`, say) read task titles, due
// dates, assignees, cost totals, per-member workload and the full
// `oldValue`/`newValue` change text of every project it was bound to. The
// project-binding work that preceded this narrowed *which* projects those
// routes could reach; it never asked whether the token was allowed to read
// tasks in the first place. `docs/api/api-tokens.md` states as fact that
// "every endpoint a PAT can reach requires one or more scopes" — these mounts
// are what makes that sentence true for the dashboard surface.
//
// Scope choice is driven by what the response actually CONTAINS:
//
//  - `task:read` everywhere, because every route's primary payload is task
//    data or a rollup computed from it. This also matches the existing mount
//    on `/tasks/:taskId/activity` in `tasks.routes.ts`, so a change feed is
//    consistently a task read whether it is asked for per-task, per-project
//    or per-workspace.
//  - `project:read` ADDITIONALLY on the two dashboards, because those two are
//    the only routes here whose body carries project-entity fields rather than
//    a denormalised `projectName` label on a task row: the workspace dashboard
//    returns a project collection (id/name/status/counts) equivalent to
//    `GET /workspaces/:id/projects`, and the project dashboard returns
//    `project.budget`. Requiring only `task:read` there would let a task-only
//    token read the project resource through the back door — the same class of
//    gap this block closes. The remaining routes deliberately do NOT require
//    it: a `projectName` string attached to a task the token may already read
//    discloses nothing the task row did not.
//
// Both factories no-op when there is no PAT on the request, so cookie sessions
// are byte-for-byte unaffected, and both no-op on non-safe methods (there are
// none here — every route is a GET).
//
// Mounted per exact path, never on a parent: Hono's `app.use` with a literal
// pattern matches THAT path only, so `/workspaces/:workspaceId/dashboard`
// does not cover `/workspaces/:workspaceId/dashboard/my-tasks`. That is also
// what keeps the two-scope mount from silently spreading to the sub-routes.
// These must be registered BEFORE the route handlers below — Hono runs the
// chain in registration order, so a `use` added afterwards would execute after
// the handler had already answered.
const taskReadScope = requireReadScopeForResource("task");
const projectReadScope = requireReadScopeForResource("project");

app.use("/workspaces/:workspaceId/dashboard", taskReadScope, projectReadScope);
app.use("/workspaces/:workspaceId/dashboard/my-tasks", taskReadScope);
app.use("/workspaces/:workspaceId/dashboard/upcoming", taskReadScope);
app.use("/workspaces/:workspaceId/activity", taskReadScope);
app.use("/projects/:projectId/dashboard", taskReadScope, projectReadScope);
app.use("/projects/:projectId/activity", taskReadScope);

app.get(
  "/workspaces/:workspaceId/dashboard",
  requireAuth,
  requireWorkspaceMember(),
  workspaceDashboard,
);

app.get(
  "/workspaces/:workspaceId/dashboard/my-tasks",
  requireAuth,
  requireWorkspaceMember(),
  validateQuery(myTasksQuerySchema),
  myTasks,
);

app.get(
  "/workspaces/:workspaceId/dashboard/upcoming",
  requireAuth,
  requireWorkspaceMember(),
  validateQuery(upcomingTasksQuerySchema),
  upcomingTasks,
);

app.get(
  "/workspaces/:workspaceId/activity",
  requireAuth,
  requireWorkspaceMember(),
  validateQuery(workspaceActivityQuerySchema),
  workspaceActivity,
);

app.get(
  "/projects/:projectId/dashboard",
  requireAuth,
  requireProjectAccess(),
  projectDashboard,
);

app.get(
  "/projects/:projectId/activity",
  requireAuth,
  requireProjectAccess(),
  projectActivity,
);

export default app;

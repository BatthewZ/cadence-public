import { Hono } from "hono";

import { myTasksQuerySchema, upcomingTasksQuerySchema, workspaceActivityQuerySchema } from "../../../shared/schemas/dashboard";
import type { AppEnv } from "../../env";
import {
  requireProjectAccess,
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

import { Hono } from "hono";

import type { AppEnv } from "../env";
import authRoutes from "./auth/auth.routes";
import dashboardRoutes from "./dashboard/dashboard.routes";
import invitationRoutes from "./invitations/invitations.routes";
import notificationRoutes from "./notifications/notifications.routes";
import projectRoutes from "./projects/projects.routes";
import searchRoutes from "./search/search.routes";
import taskGroupRoutes from "./task-groups/task-groups.routes";
import taskRoutes from "./tasks/tasks.routes";
import teamRoutes from "./teams/teams.routes";
import uploadRoutes from "./uploads/uploads.routes";
import userRoutes from "./users/users.routes";
import webhookRoutes from "./webhooks/webhooks.routes";
import workspaceRoutes from "./workspaces/workspaces.routes";

const app = new Hono<AppEnv>();

app.route("/", authRoutes);
app.route("/", userRoutes);
app.route("/", uploadRoutes);
app.route("/", workspaceRoutes);
app.route("/", projectRoutes);
app.route("/", teamRoutes);
app.route("/", invitationRoutes);
app.route("/", notificationRoutes);
app.route("/", taskGroupRoutes);
app.route("/", taskRoutes);
app.route("/", dashboardRoutes);
app.route("/", searchRoutes);
app.route("/", webhookRoutes);

export default app;

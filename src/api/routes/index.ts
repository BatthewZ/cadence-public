/**
 * Top-level API route aggregator.
 *
 * Built on `OpenAPIHono` (rather than plain `Hono`) so that documented
 * sub-apps — webhooks, workspaces, projects, tasks, etc. — can contribute
 * their `createRoute` definitions, schemas, and component registrations
 * into a single aggregate OpenAPI document served at `/api/openapi.json`.
 *
 * Sub-app registry merging happens inside `OpenAPIHono.route()`: when the
 * mounted sub-app is itself an `OpenAPIHono`, every route/schema/component
 * in its `openAPIRegistry` is replayed into the parent's registry with the
 * mount prefix applied. Non-OpenAPI sub-apps (plain `Hono`) still mount as
 * regular routes — they simply do not contribute to the spec.
 *
 * The `.doc()` call below is the single source of truth for spec
 * metadata, server URL, and security scheme advertisement.
 */

import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnv } from "../env";
import authRoutes from "./auth/auth.routes";
import calendarRoutes from "./calendar/calendar.routes";
import configRoutes from "./config/config.routes";
import dashboardRoutes from "./dashboard/dashboard.routes";
import invitationRoutes from "./invitations/invitations.routes";
import legalRoutes from "./legal/legal.routes";
import notificationRoutes from "./notifications/notifications.routes";
import projectRoutes from "./projects/projects.routes";
import searchRoutes from "./search/search.routes";
import taskGroupRoutes from "./task-groups/task-groups.routes";
import taskRoutes from "./tasks/tasks.routes";
import teamRoutes from "./teams/teams.routes";
import unsplashRoutes from "./unsplash/unsplash.routes";
import uploadRoutes from "./uploads/uploads.routes";
import userRoutes from "./users/users.routes";
import webhookRoutes from "./webhooks/webhooks.routes";
import workspaceRoutes from "./workspaces/workspaces.routes";

const app = new OpenAPIHono<AppEnv>();

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
app.route("/", legalRoutes);
app.route("/", configRoutes);
app.route("/", unsplashRoutes);
app.route("/", calendarRoutes);

// ---------------------------------------------------------------------------
// OpenAPI security schemes
// ---------------------------------------------------------------------------
//
// `bearerAuth` advertises Personal Access Tokens minted at
// /api/workspaces/:workspaceId/api-tokens. `cookieAuth` advertises the
// browser session cookie set by Better Auth's sign-in flows. Both are
// listed at the spec root so every documented operation accepts either by
// default — individual operations may narrow to one via their own
// `security` field. The api-tokens management surface does exactly that,
// pinning to `cookieAuth` only because `rejectPatAuth()` blocks PAT
// callers at runtime; advertising `bearerAuth` there would mislead Scalar
// users into pasting a PAT and getting a 403.
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "cdn_pat_...",
  description:
    "Personal Access Token. Mint at POST /api/workspaces/:workspaceId/api-tokens. Required scopes are documented per endpoint.",
});
app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "better-auth.session_token",
  description: "Browser session cookie set by /api/auth/* sign-in flows.",
});

// ---------------------------------------------------------------------------
// Spec endpoint
// ---------------------------------------------------------------------------
//
// Path resolution: this router is mounted at `/api` in `src/api/index.ts`,
// so `.doc("/openapi.json", ...)` serves at `/api/openapi.json`. The
// `servers[0].url` of `/api` matches that mount point so generated client
// snippets and Scalar's "Try it out" run against the live endpoints.
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Cadence API",
    version: "1.0.0",
    description:
      "Cadence's REST API. Covers workspaces, projects, tasks, labels, API tokens, " +
      "and webhook subscriptions. Authentication is by browser session cookie " +
      "(set by /api/auth/*) or by Personal Access Token (header " +
      "`Authorization: Bearer cdn_pat_…`). Tokens are workspace-scoped and " +
      "carry a list of permission scopes — see the API tokens documentation " +
      "for the full scope reference.",
  },
  servers: [{ url: "/api", description: "Relative API base" }],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
});

export default app;

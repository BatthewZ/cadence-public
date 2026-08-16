import { Hono } from "hono";

import { listNotificationsQuerySchema } from "../../../shared/schemas/notification";
import type { AppEnv } from "../../env";
import {
  requireReadScopeForResource,
  requireWriteScopeForResource,
} from "../../middleware/authorize";
import { requireAuth } from "../../middleware/require-auth";
import { validateQuery } from "../../middleware/validate";
import {
  deleteNotification,
  getUnreadCount,
  listNotifications,
  markAllAsRead,
  markAsRead,
} from "./notifications.handlers";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// PAT scope enforcement
// ---------------------------------------------------------------------------
//
// Notifications are the one tenant-data surface keyed by USER rather than by
// workspace, so every route here mounted `requireAuth` alone — no workspace
// guard, and until this block no capability scope either. That made the inbox
// readable by any PAT whatsoever: the producers copy project content verbatim
// into `title`/`body` (the assigned task's title, the completed task's title,
// a 200-character excerpt of the comment that mentioned you), so a token
// minted with nothing but `team:read` read task and comment text out of the
// feed without ever touching a task route.
//
// The scope family is `task`, because that is where the content comes from.
// There is no `notification:*` resource in the v1 grammar, and inventing one
// would fork the scope vocabulary for a surface that is really a view over
// task activity. This mirrors how saved views ride `project:*` in
// `projects.routes.ts`: personal state takes the scope of the resource whose
// data it exposes.
//
// Reads take `task:read`. The mutations (`PATCH .../read`,
// `POST /mark-all-read`, `DELETE`) take `task:write` — `allowDelete` is
// deliberately omitted, because deleting a notification is not deleting a
// task and must not demand the heightened `task:delete` grant. Note the
// mutations are genuine writes against durable inbox state that the human
// relies on (`mark-all-read` can bury every unread notice they have), which
// is why they are not simply folded into the read scope.
//
// Mounted per exact path: Hono's `app.use` with a literal pattern matches only
// that path, so a parent mount would not reach the nested routes. The
// `/notifications/:id` pattern additionally matches `/notifications/unread-
// count` and `/notifications/mark-all-read`, which is harmless — those paths
// are listed explicitly too, and running an idempotent scope check twice
// changes nothing. Registration order matters: these must precede the route
// handlers below or Hono would run them after the response was produced.
const taskReadScope = requireReadScopeForResource("task");
const taskWriteScope = requireWriteScopeForResource({ resource: "task" });

app.use("/notifications", taskReadScope, taskWriteScope);
app.use("/notifications/unread-count", taskReadScope, taskWriteScope);
app.use("/notifications/mark-all-read", taskReadScope, taskWriteScope);
app.use("/notifications/:id", taskReadScope, taskWriteScope);
app.use("/notifications/:id/read", taskReadScope, taskWriteScope);

app.get("/notifications", requireAuth, validateQuery(listNotificationsQuerySchema), listNotifications);
app.get("/notifications/unread-count", requireAuth, getUnreadCount);
app.patch("/notifications/:id/read", requireAuth, markAsRead);
app.post("/notifications/mark-all-read", requireAuth, markAllAsRead);
app.delete("/notifications/:id", requireAuth, deleteNotification);

export default app;

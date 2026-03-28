import { Hono } from "hono";

import { listNotificationsQuerySchema } from "../../../shared/schemas/notification";
import type { AppEnv } from "../../env";
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

app.get("/notifications", requireAuth, validateQuery(listNotificationsQuerySchema), listNotifications);
app.get("/notifications/unread-count", requireAuth, getUnreadCount);
app.patch("/notifications/:id/read", requireAuth, markAsRead);
app.post("/notifications/mark-all-read", requireAuth, markAllAsRead);
app.delete("/notifications/:id", requireAuth, deleteNotification);

export default app;

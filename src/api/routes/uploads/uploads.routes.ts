import { Hono } from "hono";

import type { AppEnv } from "../../env";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { deleteUpload, serveUpload, uploadAvatar } from "./uploads.handlers";

const app = new Hono<AppEnv>();

app.put(
  "/users/me/avatar",
  requireAuth,
  rateLimit({ max: 10, windowSeconds: 60, prefix: "avatar-upload", keyFn: defaultRateLimitKey }),
  uploadAvatar,
);

app.get(
  "/uploads/:purpose/:userId/:filename",
  requireAuth,
  rateLimit({ max: 100, windowSeconds: 60, prefix: "file-serve", keyFn: defaultRateLimitKey }),
  serveUpload,
);

app.delete("/uploads/:id", requireAuth, deleteUpload);

export default app;

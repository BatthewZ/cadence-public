import { Hono } from "hono";

import type { AppEnv } from "../../env";
import { createAuth } from "../../lib/auth";
import { rateLimit } from "../../middleware/rate-limit";

const app = new Hono<AppEnv>();

app.use(
  "/auth/sign-in/*",
  rateLimit({ max: 10, windowSeconds: 60, prefix: "auth-signin" })
);
app.use(
  "/auth/sign-up/*",
  rateLimit({ max: 5, windowSeconds: 60, prefix: "auth-signup" })
);
app.use(
  "/auth/*",
  rateLimit({ max: 30, windowSeconds: 60, prefix: "auth-general" })
);

app.on(["GET", "POST"], "/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

export default app;

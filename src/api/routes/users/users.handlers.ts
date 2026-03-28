import type { Context } from "hono";

import type { AppEnv } from "../../env";

export function getMe(c: Context<AppEnv>) {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ user });
}

import type { Context } from "hono";

import type { AppEnv } from "../../env";
import { errorResponse } from "../../lib/error-response";

export function getMe(c: Context<AppEnv>) {
  const user = c.get("user");
  if (!user) return errorResponse(c, "Unauthorized", 401);
  return c.json({ user });
}

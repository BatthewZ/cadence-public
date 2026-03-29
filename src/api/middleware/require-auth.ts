import type { MiddlewareHandler } from "hono";

import type { AppEnv } from "../env";
import { errorResponse } from "../lib/error-response";

/**
 * Middleware that returns 401 if no authenticated user is present.
 * Use on routes that require authentication.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return errorResponse(c, "Unauthorized", 401);
  }
  await next();
};

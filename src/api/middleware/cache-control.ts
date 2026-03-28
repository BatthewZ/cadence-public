import type { MiddlewareHandler } from "hono";

import type { AppEnv } from "../env";

/**
 * Adds a Cache-Control header to successful GET responses.
 *
 * Uses the `private` directive because every API endpoint sits behind
 * authentication, so responses contain user-specific data that must never be
 * stored in shared (CDN / proxy) caches.
 *
 * Apply this at the **route level** to individual GET endpoints whose data is
 * reasonably stable (e.g. project details, workspace metadata, labels). Do NOT
 * apply to volatile data (notifications, activity feeds, dashboard stats) or to
 * write endpoints (POST / PATCH / DELETE).
 *
 * @param maxAge - Duration in seconds that the browser may reuse the cached
 *   response without revalidating. Keep this conservative; stale data is worse
 *   than an extra network request.
 *
 * @example
 * ```ts
 * app.get("/projects/:id", requireAuth, cacheControl(300), getProject);
 * ```
 */
export function cacheControl(maxAge: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();

    // Only cache successful GET responses — never cache errors or non-GET
    // methods that might arrive via middleware chaining.
    if (c.req.method === "GET" && c.res.status >= 200 && c.res.status < 300) {
      c.res.headers.set("Cache-Control", `private, max-age=${maxAge}`);
    }
  };
}

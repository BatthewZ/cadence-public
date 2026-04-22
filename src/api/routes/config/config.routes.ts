/**
 * Public runtime config endpoint.
 *
 * Exposes a small set of feature flags the web client needs at boot (e.g. to
 * decide whether to render the Unsplash tab in the cover picker). This is
 * intentionally unauthenticated — the information is non-sensitive (just the
 * presence of server-side configuration) and must be readable before login so
 * we can render correctly for unauthenticated visitors.
 *
 * Why a `Cache-Control: private, max-age=300` header:
 * - `private` so shared caches (Cloudflare edge) never store it — the flag
 *   value depends on deployment env, not on shared origin-wide state, but we
 *   keep it conservative so we retain the freedom to make it user-specific.
 * - `max-age=300` (5 min) so clients do not hammer the endpoint on SPA
 *   navigations; a reload every 5 minutes is plenty for feature flags.
 */

import { Hono } from "hono";

import type { AppEnv } from "../../env";

const app = new Hono<AppEnv>();

app.get("/config", (c) => {
  c.header("Cache-Control", "private, max-age=300");
  return c.json({
    features: {
      // Match the whitespace-tolerant check in createUnsplashService so the
      // flag never claims the feature is enabled when the upstream routes
      // will return 503.
      unsplash: Boolean(c.env.UNSPLASH_ACCESS_KEY?.trim()),
    },
  });
});

export default app;

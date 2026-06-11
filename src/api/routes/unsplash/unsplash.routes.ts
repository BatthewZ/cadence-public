import { Hono } from "hono";

import {
  unsplashCuratedQuerySchema,
  unsplashSearchSchema,
} from "../../../shared/schemas/unsplash";
import type { AppEnv } from "../../env";
import { rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validateQuery } from "../../middleware/validate";
import { unsplashCurated, unsplashSearch } from "./unsplash.handlers";

const app = new Hono<AppEnv>();

// Share a single rate-limit instance across both endpoints so 30 req/min is
// a combined budget — the browser uses these interchangeably in one session.
//
// Keyed by IP (default) rather than `defaultRateLimitKey`: this rate limit
// exists to protect the external Unsplash API's per-IP quota, not to enforce
// per-user fairness. PAT clients are unlikely to hit cover-image search and
// don't need the elevated 600/min PAT bucket here.
const unsplashRateLimit = rateLimit({
  max: 30,
  windowSeconds: 60,
  prefix: "unsplash-search",
});

app.get(
  "/unsplash/search",
  requireAuth,
  unsplashRateLimit,
  validateQuery(unsplashSearchSchema),
  unsplashSearch,
);

app.get(
  "/unsplash/curated",
  requireAuth,
  unsplashRateLimit,
  validateQuery(unsplashCuratedQuerySchema),
  unsplashCurated,
);

export default app;

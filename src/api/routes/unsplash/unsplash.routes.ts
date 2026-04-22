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

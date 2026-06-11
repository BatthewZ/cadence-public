import { Hono } from "hono";

import { searchQuerySchema } from "../../../shared/schemas/search";
import type { AppEnv } from "../../env";
import { requireWorkspaceMember } from "../../middleware/authorize";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validateQuery } from "../../middleware/validate";
import { workspaceSearch } from "./search.handlers";

const app = new Hono<AppEnv>();

app.get(
  "/workspaces/:workspaceId/search",
  requireAuth,
  requireWorkspaceMember(),
  rateLimit({ max: 60, windowSeconds: 60, prefix: "search", keyFn: defaultRateLimitKey }),
  validateQuery(searchQuerySchema),
  workspaceSearch,
);

export default app;

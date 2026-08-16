import { Hono } from "hono";

import { searchQuerySchema } from "../../../shared/schemas/search";
import type { AppEnv } from "../../env";
import {
  requireReadScopeForResource,
  requireWorkspaceMember,
} from "../../middleware/authorize";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validateQuery } from "../../middleware/validate";
import { workspaceSearch } from "./search.handlers";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// PAT scope enforcement
// ---------------------------------------------------------------------------
//
// Search is the highest-yield read in the API — one `?q=` returns task titles
// AND project names/descriptions across everything the caller can reach — and
// it carried no capability-scope check at all until this mount. A PAT minted
// with `team:read` alone could run free-text search over every task title and
// description in its workspace, which falsifies the invariant
// `docs/api/api-tokens.md` states ("every endpoint a PAT can reach requires
// one or more scopes").
//
// The response is `{ projects, tasks }` — two first-class resources, each a
// full entity representation (`project` carries name/description/status/icon,
// exactly what `GET /workspaces/:id/projects` returns under `project:read`).
// So both scopes are required rather than one: gating on `task:read` alone
// would leave project search reachable by a token that may not read projects,
// and vice versa. `read:*` covers both, so the common broad-read integration
// is unaffected.
//
// Both factories no-op without a PAT, so cookie sessions are unchanged, and
// this must be registered before the route below (Hono runs the chain in
// registration order).
app.use(
  "/workspaces/:workspaceId/search",
  requireReadScopeForResource("task"),
  requireReadScopeForResource("project"),
);

app.get(
  "/workspaces/:workspaceId/search",
  requireAuth,
  requireWorkspaceMember(),
  rateLimit({ max: 60, windowSeconds: 60, prefix: "search", keyFn: defaultRateLimitKey }),
  validateQuery(searchQuerySchema),
  workspaceSearch,
);

export default app;

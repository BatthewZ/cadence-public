/**
 * Post-response middleware that writes one audit-log row per successful
 * PAT-attributed mutation.
 *
 * Why this exists as middleware rather than per-handler calls:
 *
 *  - Every mutating endpoint reachable by a PAT must be audited, and the
 *    cost of remembering an explicit call inside every handler is a
 *    guaranteed bug (one missed handler = a silent integration). A single
 *    middleware mounted at the API root applies uniformly to every route
 *    Hono matches.
 *  - The route pattern (`c.req.routePath`) plus the resolved route params
 *    (`c.req.param()`) give us enough information to derive a normalised
 *    `(resourceType, resourceId, action)` triple from the URL alone — no
 *    handler cooperation required.
 *  - GET/HEAD/OPTIONS are not audited. We deliberately limit the ledger
 *    to write traffic because read traffic is high-volume telemetry that
 *    belongs in the rate-limit / access-log surface, not the security
 *    audit ledger. The doc's "what edited / what was touched" question is
 *    fundamentally about mutations.
 *  - We only audit 2xx responses. Failed requests do not represent
 *    successful state changes and should not pollute the ledger — they
 *    are already captured by the request logger.
 *
 * `deriveAuditFields` is exported separately so it can be unit-tested
 * without standing up Hono.
 */

import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";

import type { AppEnv } from "../env";
import { recordPatAuditLog } from "../lib/audit-log";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type DerivedAuditFields = {
  resourceType: string;
  resourceId: string | null;
  action: string;
};

/**
 * Derive `(resourceType, resourceId, action)` from a Hono route pattern.
 *
 * Strategy: walk the pattern's segments from the back.
 *
 *  - If the LAST segment is a path param (`:tokenId` etc.), the request
 *    targets a single item of a collection — the resource is the static
 *    segment that precedes it ("tasks", "api-tokens") and the action is
 *    derived from the HTTP method (`update`, `replace`, `delete`).
 *  - If the LAST segment is static AND the segment before it is a path
 *    param, the URL is either `/collection/:id/verb` (e.g. `complete`,
 *    `rotate`) or `/collection/:id/subcollection` (e.g. `comments`,
 *    `labels`). We tell them apart with a plural-ending heuristic — a
 *    final segment that ends in `s` is treated as a subcollection (so
 *    `POST /tasks/:id/comments` is a "create on comments" event), while
 *    a non-plural final segment is treated as a verb action on the
 *    enclosing resource (so `POST /tasks/:id/complete` is "complete on
 *    tasks"). The heuristic is intentional: every collection name in our
 *    router is pluralised, and no verb in the v1 grammar ends in `s`.
 *  - Otherwise the URL ends in a collection (`POST /workspaces/:wid/projects`
 *    → create a project). The collection is the resource; action is method-
 *    derived.
 *
 * `idParamName` is extracted from the trailing `:name` so the caller can
 * pull the resource id out of `c.req.param(idParamName)`.
 *
 * For routes that don't fit the pattern (top-level `/health`, etc.) we
 * return `resourceType = "unknown"` rather than throwing — the audit
 * middleware only writes a row for PAT-attributed mutations, and those
 * always live under `/api/{...}` with at least one collection segment.
 */
export function deriveAuditFields(
  routePath: string,
  method: string,
): DerivedAuditFields & { idParamName: string | null } {
  const segments = routePath.split("/").filter((s) => s.length > 0);

  const fallback = (): DerivedAuditFields & { idParamName: string | null } => ({
    resourceType: "unknown",
    resourceId: null,
    action: methodToAction(method),
    idParamName: null,
  });

  if (segments.length === 0) return fallback();

  const last = segments[segments.length - 1] ?? "";
  const lastIsParam = last.startsWith(":");

  if (lastIsParam) {
    // /collection/:id → single-item op
    const resource = segments[segments.length - 2] ?? "unknown";
    return {
      resourceType: resource,
      idParamName: last.slice(1),
      resourceId: null, // resolved by the middleware against c.req.param()
      action: methodToAction(method),
    };
  }

  const prev = segments[segments.length - 2];
  if (prev && prev.startsWith(":")) {
    if (last.endsWith("s")) {
      // /collection/:id/subcollection — collection-level op on a child
      // collection (e.g. `POST /tasks/:taskId/comments`). The subcollection
      // is the resource and there's no resource id yet (we're creating it).
      // The parent id flows through `c.req.param()` and lands in metadata,
      // so the investigator still sees the context.
      return {
        resourceType: last,
        idParamName: null,
        resourceId: null,
        action: methodToAction(method),
      };
    }
    // /collection/:id/verb → verb action on a known item.
    const resource = segments[segments.length - 3] ?? "unknown";
    return {
      resourceType: resource,
      idParamName: prev.slice(1),
      resourceId: null,
      action: last,
    };
  }

  // /collection or /a/b/collection → collection-level op (typically POST)
  return {
    resourceType: last,
    idParamName: null,
    resourceId: null,
    action: methodToAction(method),
  };
}

function methodToAction(method: string): string {
  switch (method.toUpperCase()) {
    case "POST":
      return "create";
    case "PUT":
      return "replace";
    case "PATCH":
      return "update";
    case "DELETE":
      return "delete";
    case "GET":
    case "HEAD":
      return "read";
    default:
      return method.toLowerCase();
  }
}

/**
 * The audit middleware.
 *
 * Mounted once at `/api/*` so every Hono-matched route flows through it.
 * Idempotent on routes without a PAT (the early-return makes cookie traffic
 * a no-op) and on non-mutating requests.
 */
export const auditPatMutations = createMiddleware<AppEnv>(async (c, next) => {
  await next();

  const token = c.get("apiToken");
  if (!token) return;

  const method = c.req.method.toUpperCase();
  if (!MUTATION_METHODS.has(method)) return;

  // Hono populates `c.res.status` after the handler resolves.
  const status = c.res.status;
  if (status < 200 || status >= 300) return;

  // routePath(c, -1) returns the matched route pattern (e.g. "/tasks/:taskId")
  // from the final matched handler — exactly the layer we want to attribute
  // against. The deprecated `c.req.routePath` returns the middleware's own
  // registration path, which would always be "*".
  const matchedRoute = routePath(c, -1);
  const derived = deriveAuditFields(matchedRoute, method);
  const params = c.req.param() as Record<string, string>;

  const resourceId = derived.idParamName ? params[derived.idParamName] ?? null : null;

  // Drop the resourceId-shaped param out of the metadata bag so we don't
  // duplicate it; the rest of the params (project id, workspace id, etc.)
  // are useful context for an investigator reconstructing the request.
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === derived.idParamName) continue;
    metadata[key] = value;
  }

  recordPatAuditLog(c, {
    apiTokenId: token.id,
    actorUserId: token.userId,
    workspaceId: token.workspaceId,
    resourceType: derived.resourceType,
    resourceId,
    action: derived.action,
    method,
    path: c.req.path,
    status,
    metadata,
  });
});

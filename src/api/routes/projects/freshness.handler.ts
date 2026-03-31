import { eq, sql } from "drizzle-orm";
import type { Context } from "hono";

import { project } from "../../../db/schema/project";
import { task, taskGroup } from "../../../db/schema/task";
import type { AppEnv } from "../../env";
import { requireParam } from "../../lib/params";

/**
 * Returns lightweight timestamps indicating when each entity type in a project
 * was last modified. Clients poll this endpoint at short intervals (1-2s) and
 * selectively refetch only the data that changed.
 *
 * The response is user-independent (the max updatedAt for a project is the same
 * for every viewer), so we cache it at the edge via the Cloudflare Cache API
 * with a short TTL to collapse concurrent polls into a single D1 query.
 */
export async function getProjectFreshness(c: Context<AppEnv>) {
  const projectId = requireParam(c, "projectId");

  // Try edge cache first — freshness data is identical for all users viewing
  // the same project, so a shared cache avoids redundant D1 reads at scale.
  const cacheKey = new Request(`https://cadence-cache/projects/${projectId}/freshness`);
  // Cloudflare Workers expose caches.default for the zone-scoped cache.
  // Access via bracket notation to avoid type conflict with standard CacheStorage.
  const cache = (caches as unknown as Record<string, Cache>)["default"] as Cache | undefined;
  try {
    if (cache) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }
  } catch {
    // caches.default may not be available in local dev — fall through to DB
  }

  const db = c.get("db");

  const [projectResult, tasksResult, taskGroupsResult] = await db.batch([
    db.select({ updatedAt: project.updatedAt })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1),
    db.select({ max: sql<number>`MAX(${task.updatedAt})` })
      .from(task)
      .where(eq(task.projectId, projectId)),
    db.select({ max: sql<number>`MAX(${taskGroup.updatedAt})` })
      .from(taskGroup)
      .where(eq(taskGroup.projectId, projectId)),
  ] as const);

  const freshness = {
    project: projectResult[0]?.updatedAt?.getTime() ?? null,
    tasks: tasksResult[0]?.max ?? null,
    taskGroups: taskGroupsResult[0]?.max ?? null,
  };

  const body = JSON.stringify({ freshness });
  const response = new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=2",
    },
  });

  // Store in edge cache (non-blocking)
  if (cache) {
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

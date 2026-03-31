import { eq, sql } from "drizzle-orm";
import type { Context } from "hono";

import { project } from "../../../db/schema/project";
import { task } from "../../../db/schema/task";
import { workspace } from "../../../db/schema/workspace";
import type { AppEnv } from "../../env";
import { requireParam } from "../../lib/params";

/**
 * Returns lightweight timestamps indicating when workspace-level data was last
 * modified. Clients poll this at a moderate interval (3s) to detect changes to
 * the project list, dashboard stats, and My Tasks data.
 *
 * The `tasks` timestamp is a workspace-wide MAX(task.updatedAt) across all
 * projects. It is not user-specific, which allows edge caching but may produce
 * occasional false-positive invalidations for users who can't see every project.
 */
export async function getWorkspaceFreshness(c: Context<AppEnv>) {
  const workspaceId = requireParam(c, "workspaceId");

  const cacheKey = new Request(`https://cadence-cache/workspaces/${workspaceId}/freshness`);
  const cache = (caches as unknown as Record<string, Cache>)["default"] as Cache | undefined;
  try {
    if (cache) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }
  } catch {
    // caches.default may not be available in local dev
  }

  const db = c.get("db");

  const [wsResult, projectsResult, tasksResult] = await db.batch([
    db.select({ updatedAt: workspace.updatedAt })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1),
    db.select({ max: sql<number>`MAX(${project.updatedAt})` })
      .from(project)
      .where(eq(project.workspaceId, workspaceId)),
    db.select({ max: sql<number>`MAX(${task.updatedAt})` })
      .from(task)
      .innerJoin(project, eq(task.projectId, project.id))
      .where(eq(project.workspaceId, workspaceId)),
  ] as const);

  const freshness = {
    workspace: wsResult[0]?.updatedAt?.getTime() ?? null,
    projects: projectsResult[0]?.max ?? null,
    tasks: tasksResult[0]?.max ?? null,
  };

  const body = JSON.stringify({ freshness });
  const response = new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=2",
    },
  });

  if (cache) {
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

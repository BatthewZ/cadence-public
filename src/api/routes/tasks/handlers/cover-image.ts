import { eq } from "drizzle-orm";
import type { Context } from "hono";

import type { Database } from "../../../../db";
import { task } from "../../../../db/schema/task";
import type { AppEnv } from "../../../env";
import { resolveProjectAccess } from "../../../lib/access";
import { handleDeleteCover, handleUploadCover } from "../../../lib/cover-image";
import { requireParam } from "../../../lib/params";

// ---------------------------------------------------------------------------
// Cover Image Handlers
// ---------------------------------------------------------------------------

/**
 * Looks up a task by ID and verifies the caller has project access.
 * Uses cached project access from middleware when available to avoid a
 * redundant DB round-trip.
 */
function taskCoverEntity(c: Context<AppEnv>, taskId: string) {
  const cachedAccess = c.get("projectAccess");
  return async (db: Database) => {
    const [foundTask] = await db
      .select({ id: task.id, coverImageKey: task.coverImageKey, projectId: task.projectId })
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);
    if (!foundTask) return null;
    // Use cached project access from middleware when available, otherwise re-query
    if (cachedAccess) return foundTask;
    const user = c.get("user")!;
    const accessResult = await resolveProjectAccess(db, foundTask.projectId, user.id);
    if (!accessResult) return null;
    return foundTask;
  };
}

export async function uploadTaskCover(c: Context<AppEnv>) {
  const taskId = requireParam(c, "taskId");
  return handleUploadCover(c, {
    purpose: "task-cover",
    getEntity: taskCoverEntity(c, taskId),
    setEntityCover: async (db, key, updatedAt) => {
      await db
        .update(task)
        .set({ coverImageKey: key, updatedAt })
        .where(eq(task.id, taskId));
    },
  });
}

export async function deleteTaskCover(c: Context<AppEnv>) {
  const taskId = requireParam(c, "taskId");
  return handleDeleteCover(c, {
    purpose: "task-cover",
    entityLabel: "task",
    getEntity: taskCoverEntity(c, taskId),
    setEntityCover: async (db, _key, updatedAt) => {
      await db
        .update(task)
        .set({ coverImageKey: null, updatedAt })
        .where(eq(task.id, taskId));
    },
  });
}

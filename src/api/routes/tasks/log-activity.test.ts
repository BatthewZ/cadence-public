/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for the task-activity logging helpers.
 *
 * Why these tests matter:
 * - `logActivity` and `logActivityBatch` are the single sources of truth for
 *   every audit-trail row in `task_activity`. A silent regression in the
 *   apiTokenId pass-through would lose attribution for every PAT-authored
 *   action and break the "(via <TokenName>)" UI affordance without raising
 *   any observable error.
 * - We assert against real D1 (via Miniflare) so the column actually
 *   persists — a unit-level mock would happily accept a typo.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Database } from "../../../db";
import { apiToken } from "../../../db/schema/api-token";
import { taskActivity } from "../../../db/schema/task";
import {
  createTestD1,
  seedProject,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  TEST_USER,
} from "../../test-utils";
import { logActivity, logActivityBatch } from "./log-activity";

let d1: D1Database;
let dispose: () => Promise<void>;
let db: Database;
let taskId: string;
let workspaceId: string;
let tokenId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;

  await seedUser(d1, TEST_USER);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  const projectId = await seedProject(d1, workspaceId);
  const groupId = await seedTaskGroup(d1, projectId);
  taskId = await seedTask(d1, projectId, groupId);
});

beforeEach(async () => {
  db = createDb(d1);
  await d1.prepare("DELETE FROM task_activity").run();
  await d1.prepare("DELETE FROM api_token").run();

  // Insert a token to attribute activity to.
  tokenId = `tok_${crypto.randomUUID()}`;
  await db.insert(apiToken).values({
    id: tokenId,
    userId: TEST_USER.id,
    workspaceId,
    name: "Test Slackbot",
    tokenHash: `hash_${crypto.randomUUID()}`,
    tokenPrefix: "cdn_pat_abc1",
    scopes: JSON.stringify(["task:write"]),
    projectScope: "all",
    projectIds: null,
    expiresAt: null,
    revokeAt: null,
    revokedAt: null,
    createdAt: new Date(),
  });
});

afterAll(async () => {
  await dispose();
});

describe("logActivity apiTokenId persistence", () => {
  it("persists apiTokenId when provided", async () => {
    await logActivity(db, {
      taskId,
      actorId: TEST_USER.id,
      action: "created",
      apiTokenId: tokenId,
    });

    const [row] = await db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.taskId, taskId));

    expect(row.apiTokenId).toBe(tokenId);
  });

  it("defaults apiTokenId to null when omitted", async () => {
    await logActivity(db, {
      taskId,
      actorId: TEST_USER.id,
      action: "created",
    });

    const [row] = await db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.taskId, taskId));

    expect(row.apiTokenId).toBeNull();
  });

  it("stores null when apiTokenId is explicitly null (e.g. cookie auth)", async () => {
    await logActivity(db, {
      taskId,
      actorId: TEST_USER.id,
      action: "created",
      apiTokenId: null,
    });

    const [row] = await db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.taskId, taskId));

    expect(row.apiTokenId).toBeNull();
  });
});

describe("logActivityBatch apiTokenId persistence", () => {
  it("persists apiTokenId on each row in the batch", async () => {
    await logActivityBatch(db, [
      {
        taskId,
        actorId: TEST_USER.id,
        action: "moved",
        apiTokenId: tokenId,
      },
      {
        taskId,
        actorId: TEST_USER.id,
        action: "completed",
        apiTokenId: tokenId,
      },
    ]);

    const rows = await db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.taskId, taskId));

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.apiTokenId === tokenId)).toBe(true);
  });

  it("supports mixed token attribution per entry", async () => {
    await logActivityBatch(db, [
      {
        taskId,
        actorId: TEST_USER.id,
        action: "moved",
        apiTokenId: tokenId,
      },
      {
        taskId,
        actorId: TEST_USER.id,
        action: "completed",
        // Omitted apiTokenId — should land as null.
      },
    ]);

    const rows = await db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.taskId, taskId));

    const moved = rows.find((r) => r.action === "moved");
    const completed = rows.find((r) => r.action === "completed");
    expect(moved?.apiTokenId).toBe(tokenId);
    expect(completed?.apiTokenId).toBeNull();
  });

  it("no-ops on empty input", async () => {
    await logActivityBatch(db, []);
    const rows = await db.select().from(taskActivity);
    expect(rows).toHaveLength(0);
  });
});

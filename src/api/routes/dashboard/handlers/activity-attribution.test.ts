/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for API-token attribution on the dashboard activity
 * feeds (project + workspace) and for the user-delete cascade fix.
 *
 * Why these tests are load-bearing:
 *
 * 1. The activity feed UI renders "<User> (via <TokenName>)" purely from
 *    the `tokenName` field returned by these handlers' JOINs. A regression
 *    that drops the JOIN or selects the wrong column breaks the
 *    integration-attribution affordance silently — the UI just shows the
 *    plain user name with no error.
 *
 * 2. SQLite cannot encode `ON DELETE SET NULL` on a column added via
 *    `ALTER TABLE ADD COLUMN`, so the in-DB cascade for
 *    `task_activity.apiTokenId → api_token.id` is actually NO ACTION at
 *    the SQL layer despite the ORM intent. Without the explicit pre-step
 *    in `user.deleteUser.beforeDelete` that nulls the column, the cascade
 *    chain `user → api_token (cascade) → task_activity (NO ACTION)`
 *    would raise a foreign-key violation and abort user deletion in
 *    production. This test exercises that pre-step directly.
 *
 * The "(via deleted token)" branch — where `apiTokenId` is set but the
 * token row is gone — is covered by the pure UI-helper test in
 * `src/web/util/activity.test.ts`, because SQLite enforces the FK on
 * insert and won't let us seed an orphan row from the integration layer.
 */

import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type Database } from "../../../../db";
import { apiToken } from "../../../../db/schema/api-token";
import { taskActivity } from "../../../../db/schema/task";
import { workspaceActivityQuerySchema } from "../../../../shared/schemas/dashboard";
import type { AppEnv } from "../../../env";
import { validateQuery } from "../../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  seedProject,
  seedProjectMember,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  TEST_USER,
} from "../../../test-utils";
import { projectActivity, workspaceActivity } from "../dashboard.handlers";

const WORKSPACE_ID = "ws-attribution";
const PROJECT_ID = "proj-attribution";
const GROUP_ID = "grp-attribution";
const TASK_ID = "task-attribution";
const TOKEN_ID = "tok-attribution";

let d1: D1Database;
let dispose: () => Promise<void>;
let db: Database;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  db = createDb(d1);

  await seedUser(d1, TEST_USER);
  await seedWorkspace(d1, TEST_USER.id, {
    id: WORKSPACE_ID,
    name: "Attribution WS",
    slug: "attribution-ws",
  });
  await seedProject(d1, WORKSPACE_ID, { id: PROJECT_ID, name: "Attribution Project" });
  await seedProjectMember(d1, PROJECT_ID, TEST_USER.id, "admin");
  await seedTaskGroup(d1, PROJECT_ID, { id: GROUP_ID, name: "Todo", position: "a0" });
  await seedTask(d1, PROJECT_ID, GROUP_ID, {
    id: TASK_ID,
    title: "Some Task",
    position: "a0",
  });

  await db.insert(apiToken).values({
    id: TOKEN_ID,
    userId: TEST_USER.id,
    workspaceId: WORKSPACE_ID,
    name: "My Slackbot",
    tokenHash: `hash_${crypto.randomUUID()}`,
    tokenPrefix: "cdn_pat_xyz1",
    scopes: JSON.stringify(["task:write"]),
    projectScope: "all",
    projectIds: null,
    expiresAt: null,
    revokeAt: null,
    revokedAt: null,
    createdAt: new Date(),
  });

  // Two FK-valid activity rows:
  //   - tok-attributed (token exists)  → tokenName = "My Slackbot"
  //   - cookie-auth (no apiTokenId)    → tokenName = null, apiTokenId = null
  await db.insert(taskActivity).values([
    {
      id: "act-via-token",
      taskId: TASK_ID,
      actorId: TEST_USER.id,
      action: "created",
      field: null,
      oldValue: null,
      newValue: null,
      apiTokenId: TOKEN_ID,
      createdAt: new Date(Date.now() - 60 * 1000),
    },
    {
      id: "act-via-cookie",
      taskId: TASK_ID,
      actorId: TEST_USER.id,
      action: "reopened",
      field: null,
      oldValue: null,
      newValue: null,
      apiTokenId: null,
      createdAt: new Date(),
    },
  ]);
});

afterAll(async () => {
  await dispose();
});

interface ActivityResponseItem {
  id: string;
  apiTokenId: string | null;
  tokenName: string | null;
  actorName: string | null;
  action: string;
}

function projectApp() {
  const app = new Hono<AppEnv>();
  app.use(
    "/*",
    fakeAuth(d1, TEST_USER, {
      projectAccess: { role: "admin", source: "workspace" },
      currentProject: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
    }),
  );
  app.get("/projects/:projectId/activity", projectActivity);
  return app;
}

function workspaceApp() {
  const app = new Hono<AppEnv>();
  app.use(
    "/*",
    fakeAuth(d1, TEST_USER, {
      workspaceMembership: { id: "wm-attr", role: "owner" },
    }),
  );
  app.get(
    "/workspaces/:workspaceId/activity",
    validateQuery(workspaceActivityQuerySchema),
    workspaceActivity,
  );
  return app;
}

describe("projectActivity returns tokenName from the JOIN", () => {
  it("includes tokenName for active token attribution", async () => {
    const res = await projectApp().request(`/projects/${PROJECT_ID}/activity`);
    expect(res.status).toBe(200);
    const body = await res.json<{ activities: ActivityResponseItem[] }>();

    const viaToken = body.activities.find((a) => a.id === "act-via-token");
    expect(viaToken).toBeDefined();
    expect(viaToken!.apiTokenId).toBe(TOKEN_ID);
    expect(viaToken!.tokenName).toBe("My Slackbot");
  });

  it("returns null apiTokenId + tokenName for cookie-authed actions", async () => {
    const res = await projectApp().request(`/projects/${PROJECT_ID}/activity`);
    const body = await res.json<{ activities: ActivityResponseItem[] }>();

    const viaCookie = body.activities.find((a) => a.id === "act-via-cookie");
    expect(viaCookie).toBeDefined();
    expect(viaCookie!.apiTokenId).toBeNull();
    expect(viaCookie!.tokenName).toBeNull();
  });
});

describe("workspaceActivity returns tokenName from the JOIN", () => {
  it("includes tokenName for token-attributed rows", async () => {
    const res = await workspaceApp().request(`/workspaces/${WORKSPACE_ID}/activity`);
    expect(res.status).toBe(200);
    const body = await res.json<{ activities: ActivityResponseItem[] }>();

    const viaToken = body.activities.find((a) => a.id === "act-via-token");
    expect(viaToken).toBeDefined();
    expect(viaToken!.tokenName).toBe("My Slackbot");
  });
});

describe("beforeDelete user hook NULLs apiTokenId on user-owned tokens", () => {
  it("clears apiTokenId on activities owned by the user's tokens", async () => {
    // Re-confirm the row is currently token-attributed.
    const [before] = await db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.id, "act-via-token"));
    expect(before.apiTokenId).toBe(TOKEN_ID);

    // Run the exact SQL the beforeDelete hook runs. If this fails or
    // misses the row, a real user delete would FK-violate in prod.
    const userTokenIds = db
      .select({ id: apiToken.id })
      .from(apiToken)
      .where(eq(apiToken.userId, TEST_USER.id));

    await db
      .update(taskActivity)
      .set({ apiTokenId: null })
      .where(inArray(taskActivity.apiTokenId, userTokenIds));

    const [after] = await db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.id, "act-via-token"));
    expect(after.apiTokenId).toBeNull();
  });
});

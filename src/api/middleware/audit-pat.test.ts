/// <reference types="@cloudflare/workers-types" />
/**
 * Tests for the PAT audit-ledger middleware.
 *
 * The middleware turns successful 2xx PAT-attributed mutations into rows in
 * `audit_log` so an operator can answer "what has this token done?" before
 * deciding whether to revoke it. The risk of regression is concrete:
 *
 *  - If derivation breaks, the audit ledger fills with rows tagged
 *    `resourceType = "unknown"` and the "by-resource" filter becomes
 *    useless.
 *  - If the middleware writes rows for non-2xx responses, an attacker can
 *    flood the audit table with failed attempts (DoS the audit surface).
 *  - If the middleware audits cookie traffic, the table conflates human
 *    edits with machine edits and the security signal degrades.
 *  - If the middleware doesn't audit a mutation that succeeds, the
 *    documented "every PAT mutation is attributed" claim is false.
 *
 * The derivation logic is exported as a pure helper so we can lock down
 * each rule without standing up D1.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../db";
import { type ApiToken, apiToken,auditLog } from "../../db/schema";
import type { AppEnv } from "../env";
import {
  createTestD1,
  seedUser,
  seedWorkspace,
  TEST_USER,
} from "../test-utils";
import { auditPatMutations,deriveAuditFields } from "./audit-pat";

let d1: D1Database;
let dispose: () => Promise<void>;
let workspaceId: string;
let tokenId: string;

beforeAll(async () => {
  const result = await createTestD1();
  d1 = result.d1;
  dispose = result.dispose;
  await seedUser(d1);
  // seedWorkspace already creates the owner workspace_member row.
  workspaceId = await seedWorkspace(d1, TEST_USER.id);

  // Insert a token row we can attribute audit log entries against.
  tokenId = crypto.randomUUID();
  await d1
    .prepare(
      `INSERT INTO api_token (id, userId, workspaceId, name, tokenHash, tokenPrefix, scopes, projectScope, projectIds, lastUsedAt, expiresAt, revokeAt, revokedAt, rotatedToId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tokenId,
      TEST_USER.id,
      workspaceId,
      "Test token",
      "hash-deadbeef",
      "cdn_pat_abcd",
      JSON.stringify(["task:write"]),
      "all",
      null,
      null,
      null,
      null,
      null,
      null,
      Math.floor(Date.now() / 1000),
    )
    .run();
});

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  await d1.prepare("DELETE FROM audit_log").run();
});

// ---------------------------------------------------------------------------
// deriveAuditFields — pure logic
// ---------------------------------------------------------------------------

describe("deriveAuditFields", () => {
  it("treats /collection/:id with PATCH as an update on the resource", () => {
    const r = deriveAuditFields("/tasks/:taskId", "PATCH");
    expect(r.resourceType).toBe("tasks");
    expect(r.idParamName).toBe("taskId");
    expect(r.action).toBe("update");
  });

  it("treats /collection with POST as a create on the collection", () => {
    const r = deriveAuditFields("/workspaces/:workspaceId/projects", "POST");
    expect(r.resourceType).toBe("projects");
    expect(r.idParamName).toBe(null);
    expect(r.action).toBe("create");
  });

  it("treats /collection/:id with DELETE as a delete on the resource", () => {
    const r = deriveAuditFields("/projects/:projectId", "DELETE");
    expect(r.resourceType).toBe("projects");
    expect(r.idParamName).toBe("projectId");
    expect(r.action).toBe("delete");
  });

  it("treats /collection/:id/verb as a verb-action on the enclosing resource", () => {
    const r = deriveAuditFields("/tasks/:taskId/complete", "POST");
    expect(r.resourceType).toBe("tasks");
    expect(r.idParamName).toBe("taskId");
    expect(r.action).toBe("complete");
  });

  it("captures the rotate verb under api-tokens", () => {
    const r = deriveAuditFields(
      "/workspaces/:workspaceId/api-tokens/:tokenId/rotate",
      "POST",
    );
    expect(r.resourceType).toBe("api-tokens");
    expect(r.idParamName).toBe("tokenId");
    expect(r.action).toBe("rotate");
  });

  it("falls back to resourceType='unknown' for an empty pattern", () => {
    const r = deriveAuditFields("/", "POST");
    expect(r.resourceType).toBe("unknown");
    expect(r.idParamName).toBe(null);
  });

  it("maps PUT to 'replace' on a plain /collection/:id path", () => {
    // No verb on the end so the method-derived action applies.
    const r = deriveAuditFields("/projects/:projectId", "PUT");
    expect(r.action).toBe("replace");
  });

  it("treats /collection/:id/subcollection (plural-trailing) as a subcollection POST", () => {
    // `comments` ends in 's' so we treat the URL as a collection-level op
    // on the child collection, not a verb. `POST /tasks/:id/comments`
    // creates a comment — there's no comment id yet so idParamName is
    // null; the parent task id will land in metadata via c.req.param().
    const r = deriveAuditFields("/tasks/:taskId/comments", "POST");
    expect(r.resourceType).toBe("comments");
    expect(r.idParamName).toBeNull();
    expect(r.action).toBe("create");
  });

  it("keeps verb derivation for non-plural trailing words", () => {
    // `cover` does not end in 's' so it remains a verb action on the task.
    const r = deriveAuditFields("/tasks/:taskId/cover", "PUT");
    expect(r.resourceType).toBe("tasks");
    expect(r.action).toBe("cover");
  });
});

// ---------------------------------------------------------------------------
// auditPatMutations — integration against a real D1
// ---------------------------------------------------------------------------

function buildAuditApp(opts: {
  withToken: boolean;
  status?: number;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.env) {
      (c as unknown as { env: Record<string, unknown> }).env = {};
    }
    (c.env as Record<string, unknown>).DB = d1;
    c.set("db", createDb(d1));
    c.set("user", null);
    c.set("session", null);
    if (opts.withToken) {
      c.set("apiToken", {
        id: tokenId,
        userId: TEST_USER.id,
        workspaceId,
        name: "Test token",
        tokenHash: "hash-deadbeef",
        tokenPrefix: "cdn_pat_abcd",
        scopes: JSON.stringify(["task:write"]),
        projectScope: "all",
        projectIds: null,
        lastUsedAt: null,
        expiresAt: null,
        revokeAt: null,
        revokedAt: null,
        rotatedToId: null,
        createdAt: new Date(),
      } as ApiToken);
    } else {
      c.set("apiToken", null);
    }
    await next();
  });

  app.use("*", auditPatMutations);

  app.post("/tasks/:taskId/complete", (c) => {
    return c.json({ ok: true }, (opts.status ?? 200) as 200);
  });
  app.post("/workspaces/:workspaceId/projects", (c) => {
    return c.json({ ok: true }, (opts.status ?? 201) as 201);
  });
  app.get("/tasks/:taskId", (c) => {
    return c.json({ ok: true });
  });

  return app;
}

async function readAuditRows() {
  const db = createDb(d1);
  return db.select().from(auditLog);
}

describe("auditPatMutations", () => {
  it("writes one row when a PAT performs a successful verb mutation", async () => {
    const app = buildAuditApp({ withToken: true });
    const res = await app.request(
      new Request("http://localhost/tasks/task-123/complete", { method: "POST" }),
    );
    expect(res.status).toBe(200);

    // Let deferWork settle.
    await new Promise((r) => setTimeout(r, 25));

    const rows = await readAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].apiTokenId).toBe(tokenId);
    expect(rows[0].actorUserId).toBe(TEST_USER.id);
    expect(rows[0].workspaceId).toBe(workspaceId);
    expect(rows[0].resourceType).toBe("tasks");
    expect(rows[0].resourceId).toBe("task-123");
    expect(rows[0].action).toBe("complete");
    expect(rows[0].method).toBe("POST");
    expect(rows[0].path).toBe("/tasks/task-123/complete");
    expect(rows[0].status).toBe(200);
  });

  it("writes one row when a PAT creates a collection item", async () => {
    const app = buildAuditApp({ withToken: true });
    const res = await app.request(
      new Request("http://localhost/workspaces/ws-1/projects", { method: "POST" }),
    );
    expect(res.status).toBe(201);

    await new Promise((r) => setTimeout(r, 25));

    const rows = await readAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceType).toBe("projects");
    expect(rows[0].resourceId).toBeNull();
    expect(rows[0].action).toBe("create");
    expect(rows[0].metadata).toContain("ws-1");
  });

  it("does NOT write a row when no PAT is present (cookie traffic)", async () => {
    const app = buildAuditApp({ withToken: false });
    const res = await app.request(
      new Request("http://localhost/tasks/task-1/complete", { method: "POST" }),
    );
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 25));

    const rows = await readAuditRows();
    expect(rows).toHaveLength(0);
  });

  it("does NOT write a row for GET requests", async () => {
    const app = buildAuditApp({ withToken: true });
    const res = await app.request(
      new Request("http://localhost/tasks/task-1", { method: "GET" }),
    );
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 25));

    const rows = await readAuditRows();
    expect(rows).toHaveLength(0);
  });

  it("does NOT write a row when the response is non-2xx", async () => {
    const app = buildAuditApp({ withToken: true, status: 400 });
    const res = await app.request(
      new Request("http://localhost/tasks/task-1/complete", { method: "POST" }),
    );
    expect(res.status).toBe(400);

    await new Promise((r) => setTimeout(r, 25));

    const rows = await readAuditRows();
    expect(rows).toHaveLength(0);
  });
});

// Touch apiToken import so eslint doesn't flag it; the variable participates
// in seed-time SQL but never in an assertion.
void apiToken;

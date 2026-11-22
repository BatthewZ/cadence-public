/// <reference types="@cloudflare/workers-types" />

import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../db";
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  WRITE_ERROR_CODES,
} from "../../shared/constants/offline-sync";
import type { AppEnv } from "../env";
import taskRoutes from "../routes/tasks/tasks.routes";
import {
  createTestD1WithR2,
  fakeAuth,
  fakePat,
  seedProject,
  seedProjectMember,
  seedTask,
  seedTaskGroup,
  seedUser,
  seedWorkspace,
  TEST_USER,
  TEST_USER_2,
} from "../test-utils";
import { auditPatMutations } from "./audit-pat";
import { idempotency,IDEMPOTENCY_MAX_STORED_BODY_BYTES, IDEMPOTENCY_PENDING_TIMEOUT_MS } from "./idempotency";

let d1: D1Database;
let storage: R2Bucket;
let dispose: () => Promise<void>;
let workspaceId: string;
let projectId: string;
let taskGroupId: string;

beforeAll(async () => {
  ({ d1, storage, dispose } = await createTestD1WithR2());
  await seedUser(d1);
  await seedUser(d1, TEST_USER_2);
  workspaceId = await seedWorkspace(d1, TEST_USER.id);
  projectId = await seedProject(d1, workspaceId);
  await seedProjectMember(d1, projectId, TEST_USER.id, "admin");
  taskGroupId = await seedTaskGroup(d1, projectId);
});

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  await d1.prepare("DELETE FROM idempotency_key").run();
});

const unauthenticated: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("db", createDb(d1));
  c.set("user", null);
  c.set("session", null);
  c.set("requestId", "test-request-id");
  await next();
};

/** A test app whose single route counts how many times it actually ran. */
function counterApp(
  respond: (c: Context<AppEnv>, runs: number) => Response | Promise<Response> = (c, runs) =>
    c.json({ runs }, 201),
  auth: MiddlewareHandler<AppEnv> = fakeAuth(d1),
) {
  const state = { runs: 0 };
  const app = new Hono<AppEnv>();
  app.use("/api/*", auth);
  app.use("/api/*", idempotency);
  const handler = async (c: Context<AppEnv>) => {
    state.runs++;
    return respond(c, state.runs);
  };
  app.post("/api/things", handler);
  app.get("/api/things", handler);
  app.post("/api/auth/sign-in", handler);
  return { app, state };
}

function post(path: string, body: unknown, key?: string, method = "POST"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== undefined) headers[IDEMPOTENCY_KEY_HEADER] = key;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function storedRows(): Promise<{ key: string; status: number | null }[]> {
  const { results } = await d1
    .prepare("SELECT key, status FROM idempotency_key")
    .all<{ key: string; status: number | null }>();
  return results;
}

/** A promise the test resolves by hand, to hold a handler mid-request. */
function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function waitFor(condition: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100 && !(await condition()); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("idempotency middleware", () => {
  it("leaves requests without the header untouched", async () => {
    const { app, state } = counterApp();
    await app.request(post("/api/things", { a: 1 }));
    await app.request(post("/api/things", { a: 1 }));
    expect(state.runs).toBe(2);
    expect(await storedRows()).toEqual([]);
  });

  it("replays the stored status and body without re-running the handler", async () => {
    const { app, state } = counterApp();
    const first = await app.request(post("/api/things", { a: 1 }, "key-1"));
    const second = await app.request(post("/api/things", { a: 1 }, "key-1"));

    expect(state.runs).toBe(1);
    expect(first.status).toBe(201);
    expect(first.headers.get(IDEMPOTENT_REPLAYED_HEADER)).toBeNull();
    expect(second.status).toBe(201);
    expect(second.headers.get(IDEMPOTENT_REPLAYED_HEADER)).toBe("true");
    expect(second.headers.get("Content-Type")).toContain("application/json");
    expect(await second.json()).toEqual(await first.json());
  });

  it("answers 422 idempotency_mismatch when the key is reused with a different body", async () => {
    const { app, state } = counterApp();
    await app.request(post("/api/things", { a: 1 }, "key-2"));
    const res = await app.request(post("/api/things", { a: 2 }, "key-2"));

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: WRITE_ERROR_CODES.idempotencyMismatch });
    expect(state.runs).toBe(1);
  });

  it("answers 422 when the key is reused on a different path", async () => {
    const { app } = counterApp();
    await app.request(post("/api/things", { a: 1 }, "key-path"));
    const res = await app.request(post("/api/things?x=1", { a: 1 }, "key-path"));
    expect(res.status).toBe(422);
  });

  it("answers 409 idempotency_in_progress with Retry-After while the first request runs", async () => {
    const held = gate();
    const { app, state } = counterApp(async (c) => {
      await held.promise;
      return c.json({ ok: true }, 201);
    });

    const first = app.request(post("/api/things", { a: 1 }, "key-3"));
    await waitFor(() => state.runs === 1);
    const concurrent = await app.request(post("/api/things", { a: 1 }, "key-3"));

    expect(concurrent.status).toBe(409);
    expect(concurrent.headers.get("Retry-After")).toBe("1");
    expect(await concurrent.json()).toMatchObject({ code: WRITE_ERROR_CODES.idempotencyInProgress });

    held.resolve();
    expect((await first).status).toBe(201);
    expect(state.runs).toBe(1);
  });

  it("takes over a pending key older than the timeout and runs the handler", async () => {
    const held = gate();
    const crashed = counterApp(async (c) => {
      await held.promise;
      return c.json({ ok: true });
    });
    const stuck = crashed.app.request(post("/api/things", { a: 1 }, "key-4"));
    await waitFor(() => crashed.state.runs === 1);
    const staleSeconds = Math.floor((Date.now() - IDEMPOTENCY_PENDING_TIMEOUT_MS - 5_000) / 1000);
    await d1.prepare("UPDATE idempotency_key SET createdAt = ? WHERE key = ?").bind(staleSeconds, "key-4").run();

    const { app, state } = counterApp();
    const res = await app.request(post("/api/things", { a: 1 }, "key-4"));

    expect(res.status).toBe(201);
    expect(state.runs).toBe(1);
    expect(await storedRows()).toEqual([{ key: "key-4", status: 201 }]);

    held.resolve();
    await stuck;
  });

  it.each([
    ["a 5xx", (c: Context<AppEnv>) => c.json({ error: "boom" }, 500)],
    ["a 4xx", (c: Context<AppEnv>) => c.json({ error: "nope" }, 400)],
    ["a non-JSON 2xx", (c: Context<AppEnv>) => c.text("ok", 200)],
    ["an oversized 2xx", (c: Context<AppEnv>) => c.json({ pad: "x".repeat(IDEMPOTENCY_MAX_STORED_BODY_BYTES) })],
  ])("does not store %s, so a retry re-executes", async (_label, respond) => {
    const { app, state } = counterApp(respond);
    await app.request(post("/api/things", { a: 1 }, "key-5"));
    await app.request(post("/api/things", { a: 1 }, "key-5"));

    expect(state.runs).toBe(2);
    expect(await storedRows()).toEqual([]);
  });

  it("releases the key when the handler throws", async () => {
    const { app, state } = counterApp(() => {
      throw new Error("handler crashed");
    });
    const res = await app.request(post("/api/things", { a: 1 }, "key-6"));
    expect(res.status).toBe(500);
    await app.request(post("/api/things", { a: 1 }, "key-6"));
    expect(state.runs).toBe(2);
    expect(await storedRows()).toEqual([]);
  });

  it("rejects a malformed key with 400", async () => {
    const { app, state } = counterApp();
    const res = await app.request(post("/api/things", { a: 1 }, "not a valid key!"));
    expect(res.status).toBe(400);
    expect(state.runs).toBe(0);
  });

  it("ignores the header on GET", async () => {
    const { app, state } = counterApp();
    await app.request(post("/api/things", null, "key-7", "GET"));
    await app.request(post("/api/things", null, "key-7", "GET"));
    expect(state.runs).toBe(2);
  });

  it("ignores the header under /api/auth/", async () => {
    const { app, state } = counterApp();
    await app.request(post("/api/auth/sign-in", { a: 1 }, "key-8"));
    await app.request(post("/api/auth/sign-in", { a: 1 }, "key-8"));
    expect(state.runs).toBe(2);
  });

  it("passes unauthenticated requests through untouched", async () => {
    const { app, state } = counterApp(undefined, unauthenticated);
    await app.request(post("/api/things", { a: 1 }, "not a valid key!"));
    await app.request(post("/api/things", { a: 1 }, "not a valid key!"));
    expect(state.runs).toBe(2);
    expect(await storedRows()).toEqual([]);
  });

  it("scopes keys per user", async () => {
    const first = counterApp(undefined, fakeAuth(d1, TEST_USER));
    const second = counterApp(undefined, fakeAuth(d1, TEST_USER_2));
    await first.app.request(post("/api/things", { a: 1 }, "shared-key"));
    const res = await second.app.request(post("/api/things", { a: 1 }, "shared-key"));

    expect(second.state.runs).toBe(1);
    expect(res.headers.get(IDEMPOTENT_REPLAYED_HEADER)).toBeNull();
  });
});

describe("idempotency middleware in front of real routes", () => {
  function routesApp() {
    const app = new Hono<AppEnv>();
    app.use("/api/*", fakeAuth(d1, TEST_USER, { env: { STORAGE: storage } }));
    app.use("/api/*", idempotency);
    app.route("/api", taskRoutes);
    return app;
  }

  async function taskCount(): Promise<number> {
    const row = await d1
      .prepare("SELECT COUNT(*) AS n FROM task WHERE projectId = ?")
      .bind(projectId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  it("a replayed JSON create returns the same task and writes one row", async () => {
    const app = routesApp();
    const before = await taskCount();
    const request = () => post(`/api/projects/${projectId}/tasks`, { title: "Once", taskGroupId }, "create-once");

    const first = await app.request(request());
    const second = await app.request(request());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get(IDEMPOTENT_REPLAYED_HEADER)).toBe("true");
    const [a, b] = await Promise.all([first.json<{ task: { id: string } }>(), second.json<{ task: { id: string } }>()]);
    expect(b.task.id).toBe(a.task.id);
    expect(await taskCount()).toBe(before + 1);
  });

  it("a multipart upload still parses its form body behind the middleware", async () => {
    const app = routesApp();
    const taskId = await seedTask(d1, projectId, taskGroupId, { title: "With attachment" });
    const pdf = new Uint8Array(64);
    pdf.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0);
    const request = () => {
      const form = new FormData();
      form.append("file", new File([pdf], "doc.pdf", { type: "application/pdf" }));
      return new Request(`http://localhost/api/tasks/${taskId}/attachments`, {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: "upload-once" },
        body: form,
      });
    };

    const res = await app.request(request());
    expect(res.status).toBe(201);
    const body = await res.json<{ attachment: { filename: string } }>();
    expect(body.attachment.filename).toBe("doc.pdf");
  });
});

describe("idempotency middleware ahead of the PAT audit ledger", () => {
  it("does not audit a replay a second time", async () => {
    const token = fakePat({ workspaceId });
    await d1
      .prepare(
        "INSERT INTO api_token (id, userId, workspaceId, name, tokenHash, tokenPrefix, scopes, projectScope, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(token.id, token.userId, workspaceId, token.name, token.tokenHash, token.tokenPrefix, token.scopes, token.projectScope, 0)
      .run();

    const deferred: Promise<unknown>[] = [];
    const executionCtx = {
      waitUntil: (p: Promise<unknown>) => deferred.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    const app = new Hono<AppEnv>();
    app.use("/api/*", fakeAuth(d1, TEST_USER, { apiToken: token }));
    app.use("/api/*", idempotency);
    app.use("/api/*", auditPatMutations);
    app.post("/api/things", (c) => c.json({ ok: true }, 201));

    await app.request(post("/api/things", { a: 1 }, "audited-once"), undefined, undefined, executionCtx);
    const replay = await app.request(post("/api/things", { a: 1 }, "audited-once"), undefined, undefined, executionCtx);
    await Promise.all(deferred);

    expect(replay.headers.get(IDEMPOTENT_REPLAYED_HEADER)).toBe("true");
    const row = await d1
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE apiTokenId = ?")
      .bind(token.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});

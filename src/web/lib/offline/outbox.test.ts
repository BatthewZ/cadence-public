import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDEMPOTENCY_KEY_HEADER, WRITE_ERROR_CODES } from "@/shared/constants/offline-sync";

import { type OfflineDb, openOfflineDb } from "./idb";
import {
  MAX_SERVER_ERROR_ATTEMPTS,
  Outbox,
  type OutboxDeps,
  queuedCount,
  type Refusal,
} from "./outbox";
import type { WriteRequest } from "./perform-write";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | "network";

interface Sent {
  method: string;
  path: string;
  key: string | null;
  body: unknown;
}

/** A fetch that answers from a script, one reply per call; the last reply repeats. */
function scriptedFetch(replies: Reply[]) {
  const sent: Sent[] = [];
  const impl = vi.fn((path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({
      method: init?.method ?? "GET",
      path,
      key: headers.get(IDEMPOTENCY_KEY_HEADER),
      body: init?.body ? (JSON.parse(init.body as string) as unknown) : undefined,
    });
    const reply = replies.length > 1 ? replies.shift()! : replies[0];
    if (reply === "network") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(
      new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status,
        headers: { "Content-Type": "application/json", ...reply.headers },
      })
    );
  });
  return { impl: impl as unknown as typeof fetch, sent };
}

const write = (n: number): WriteRequest => ({
  method: "PATCH",
  path: `/api/tasks/t${n}`,
  body: { title: `Task ${n}` },
  label: `Rename task ${n}`,
});

let db: OfflineDb;
let online: boolean;

function makeOutbox(fetchImpl: typeof fetch, overrides: Partial<OutboxDeps> = {}) {
  return new Outbox({
    db,
    userId: "u1",
    isOnline: () => online,
    onDrained: vi.fn(),
    onUnauthorized: vi.fn(),
    fetch: fetchImpl,
    channel: null,
    lock: (_name, run) => run(),
    ...overrides,
  });
}

async function settle(outbox: Outbox) {
  // A drain may hand over to a second one (`flushAgain`); wait until none is running.
  for (let i = 0; i < 10; i++) {
    await outbox.whenSettled();
    await new Promise((r) => setTimeout(r, 0));
    if (outbox.getStatus().state !== "syncing") return;
  }
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  online = true;
  db = await openOfflineDb("u1");
});

afterEach(() => {
  db.close();
});

describe("Outbox", () => {
  it("replays in the order the writes were made, once each, and refreshes once drained", async () => {
    const { impl, sent } = scriptedFetch([{ status: 200, body: { ok: true } }]);
    online = false;
    const outbox = makeOutbox(impl);
    await outbox.start();
    await outbox.enqueue(write(2), 20, "k2");
    await outbox.enqueue(write(1), 10, "k1");
    await outbox.enqueue(write(3), 30, "k3");
    expect(outbox.getStatus().pending).toBe(3);
    expect(sent).toHaveLength(0);

    online = true;
    outbox.setOnline(true);
    await settle(outbox);

    expect(sent.map((s) => s.path)).toEqual(["/api/tasks/t1", "/api/tasks/t2", "/api/tasks/t3"]);
    expect(sent.map((s) => s.key)).toEqual(["k1", "k2", "k3"]);
    expect(sent[0].body).toEqual({ title: "Task 1" });
    expect(outbox.getStatus()).toMatchObject({ pending: 0, state: "idle" });
    expect(await outbox.list()).toEqual([]);
    expect((outbox as unknown as { deps: OutboxDeps }).deps.onDrained).toHaveBeenCalledOnce();
  });

  it("keeps a write whose response never came and resends it with the same key", async () => {
    const { impl, sent } = scriptedFetch(["network", { status: 200, body: {} }]);
    const outbox = makeOutbox(impl);
    await outbox.start();
    await outbox.enqueue(write(1), 1, "same-key");
    outbox.kick();
    await settle(outbox);

    expect(outbox.getStatus()).toMatchObject({ state: "waiting", pending: 1 });
    expect(outbox.getStatus().nextRetryAt).not.toBeNull();

    outbox.setOnline(true);
    await settle(outbox);
    expect(sent.map((s) => s.key)).toEqual(["same-key", "same-key"]);
    expect(outbox.getStatus().pending).toBe(0);
  });

  it("drops a refused write, reports it, and carries on with the next", async () => {
    const { impl, sent } = scriptedFetch([
      { status: 404, body: { error: "Task not found" } },
      { status: 200, body: {} },
    ]);
    const outbox = makeOutbox(impl);
    const refusals: Refusal[] = [];
    outbox.subscribeRefusals((r) => refusals.push(r));
    await outbox.start();
    await outbox.enqueue(write(1), 1, "k1");
    await outbox.enqueue(write(2), 2, "k2");
    outbox.kick();
    await settle(outbox);

    expect(sent).toHaveLength(2);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ status: 404, message: "Task not found" });
    expect(refusals[0].write.label).toBe("Rename task 1");
    expect(outbox.getStatus().pending).toBe(0);
  });

  it("treats a create whose id already exists as applied, without a refusal", async () => {
    const { impl } = scriptedFetch([
      { status: 409, body: { error: "exists", code: WRITE_ERROR_CODES.idConflict } },
    ]);
    const outbox = makeOutbox(impl);
    const refusals: Refusal[] = [];
    outbox.subscribeRefusals((r) => refusals.push(r));
    await outbox.start();
    await outbox.enqueue(write(1), 1, "k1");
    outbox.kick();
    await settle(outbox);

    expect(refusals).toEqual([]);
    expect(outbox.getStatus().pending).toBe(0);
  });

  it("stops on 401, keeps the queue, and asks for sign-in", async () => {
    const { impl, sent } = scriptedFetch([{ status: 401, body: { error: "Unauthorized" } }]);
    const onUnauthorized = vi.fn();
    const outbox = makeOutbox(impl, { onUnauthorized });
    await outbox.start();
    await outbox.enqueue(write(1), 1, "k1");
    await outbox.enqueue(write(2), 2, "k2");
    outbox.kick();
    await settle(outbox);

    expect(sent).toHaveLength(1);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(outbox.getStatus()).toMatchObject({
      state: "blocked",
      blockedReason: "auth",
      pending: 2,
    });

    outbox.kick();
    await settle(outbox);
    expect(sent).toHaveLength(1);
  });

  it("waits out a 429 for its Retry-After", async () => {
    const { impl } = scriptedFetch([
      { status: 429, body: { error: "Too many requests" }, headers: { "Retry-After": "7" } },
    ]);
    const now = 1_000_000;
    const outbox = makeOutbox(impl, { now: () => now });
    await outbox.start();
    await outbox.enqueue(write(1), 1, "k1");
    outbox.kick();
    await settle(outbox);

    expect(outbox.getStatus()).toMatchObject({
      state: "waiting",
      nextRetryAt: now + 7_000,
      pending: 1,
    });
    outbox.stop();
  });

  it("retries a request still running elsewhere (idempotency in progress) instead of refusing it", async () => {
    const { impl } = scriptedFetch([
      { status: 409, body: { error: "busy", code: WRITE_ERROR_CODES.idempotencyInProgress } },
    ]);
    const refusals: Refusal[] = [];
    const outbox = makeOutbox(impl);
    outbox.subscribeRefusals((r) => refusals.push(r));
    await outbox.start();
    await outbox.enqueue(write(1), 1, "k1");
    outbox.kick();
    await settle(outbox);

    expect(refusals).toEqual([]);
    expect(outbox.getStatus()).toMatchObject({ state: "waiting", pending: 1 });
    outbox.stop();
  });

  it("marks a write stuck after repeated server errors, survives a reload, and can be retried or discarded", async () => {
    const { impl, sent } = scriptedFetch([
      { status: 500, body: { error: "Internal Server Error" } },
    ]);
    const outbox = makeOutbox(impl);
    await outbox.start();
    await outbox.enqueue(write(1), 1, "k1");
    await outbox.enqueue(write(2), 2, "k2");
    for (let i = 0; i < MAX_SERVER_ERROR_ATTEMPTS; i++) {
      outbox.setOnline(true);
      await settle(outbox);
    }
    expect(sent).toHaveLength(MAX_SERVER_ERROR_ATTEMPTS);
    expect(sent.every((s) => s.path === "/api/tasks/t1")).toBe(true);
    expect(outbox.getStatus()).toMatchObject({
      state: "blocked",
      blockedReason: "stuck",
      pending: 2,
    });
    outbox.stop();

    const reloaded = makeOutbox(impl);
    await reloaded.start();
    expect(reloaded.getStatus()).toMatchObject({ state: "blocked", blockedReason: "stuck" });
    const [stuck] = await reloaded.list();
    expect(stuck.stuck).toBe(true);

    const ok = scriptedFetch([{ status: 200, body: {} }]);
    const fixed = makeOutbox(ok.impl);
    await fixed.start();
    const [first] = await fixed.list();
    await fixed.discard(first.id!);
    await settle(fixed);
    expect(ok.sent.map((s) => s.path)).toEqual(["/api/tasks/t2"]);
    expect(fixed.getStatus()).toMatchObject({ state: "idle", pending: 0 });
  });

  it("keeps queued writes across a reload and sends them on start", async () => {
    online = false;
    const first = makeOutbox(scriptedFetch([{ status: 200 }]).impl);
    await first.start();
    await first.enqueue(write(1), 1, "k1");
    first.stop();

    online = true;
    const { impl, sent } = scriptedFetch([{ status: 204 }]);
    const second = makeOutbox(impl);
    await second.start();
    await settle(second);
    expect(sent.map((s) => s.key)).toEqual(["k1"]);
    expect(second.getStatus().pending).toBe(0);
  });

  it("is a read barrier only while draining", async () => {
    let release: (value: Response) => void = () => undefined;
    const impl = vi.fn(
      () => new Promise<Response>((resolve) => (release = resolve))
    ) as unknown as typeof fetch;
    const outbox = makeOutbox(impl);
    await outbox.start();
    await expect(outbox.whenSettled()).resolves.toBeUndefined();

    await outbox.enqueue(write(1), 1, "k1");
    outbox.kick();
    let settled = false;
    void outbox.whenSettled().then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    release(new Response(null, { status: 204 }));
    await settle(outbox);
    expect(settled).toBe(true);
  });

  it("sends each write once when two tabs drain the same queue", async () => {
    const { impl, sent } = scriptedFetch([{ status: 200, body: {} }]);
    let chain = Promise.resolve();
    const sharedLock = (_name: string, run: () => Promise<void>) => {
      const next = chain.then(run);
      chain = next.catch(() => undefined);
      return next;
    };
    const tabA = makeOutbox(impl, { lock: sharedLock });
    const tabB = makeOutbox(impl, { lock: sharedLock });
    await tabA.start();
    await tabB.start();
    await tabA.enqueue(write(1), 1, "k1");
    await tabB.enqueue(write(2), 2, "k2");
    await tabA.enqueue(write(3), 3, "k3");
    tabA.kick();
    tabB.kick();
    await settle(tabA);
    await settle(tabB);

    expect(sent.map((s) => s.key).sort()).toEqual(["k1", "k2", "k3"]);
  });
});

/** A fetch whose replies the test releases one request at a time, by path. */
function heldFetch() {
  const held = new Map<string, (reply: Response) => void>();
  const sent: string[] = [];
  const impl = vi.fn(
    (path: string) =>
      new Promise<Response>((resolve) => {
        sent.push(path);
        held.set(path, resolve);
      })
  ) as unknown as typeof fetch;
  const reply = async (path: string, status = 200, body: unknown = { path }) => {
    held.get(path)!(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
    held.delete(path);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { impl, sent, reply };
}

const newWrite = (n: number) => ({ request: write(n), key: `k${n}` });

describe("Outbox.send (writes made online)", () => {
  it("holds a write made while an earlier one is in flight until that one is answered", async () => {
    const { impl, sent, reply } = heldFetch();
    const outbox = makeOutbox(impl);
    await outbox.start();

    const [create] = await outbox.send([newWrite(1)], 1);
    expect(outbox.canSendNow()).toBe(true);
    const [edit] = await outbox.send([newWrite(2)], 2);
    await vi.waitFor(() => expect(sent).toEqual(["/api/tasks/t1"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toEqual(["/api/tasks/t1"]);

    await reply("/api/tasks/t1");
    await expect(create).resolves.toMatchObject({ kind: "ok", data: { path: "/api/tasks/t1" } });
    await vi.waitFor(() => expect(sent).toEqual(["/api/tasks/t1", "/api/tasks/t2"]));
    await reply("/api/tasks/t2");
    await expect(edit).resolves.toMatchObject({ kind: "ok", data: { path: "/api/tasks/t2" } });

    await settle(outbox);
    expect(outbox.getStatus()).toMatchObject({ pending: 0, sending: 0, state: "idle" });
    // Each caller applied its own reply: no refetch of everything after every online edit.
    expect((outbox as unknown as { deps: OutboxDeps }).deps.onDrained).not.toHaveBeenCalled();
  });

  it("doesn't count writes being sent online as queued for the person", async () => {
    const { impl, reply } = heldFetch();
    const outbox = makeOutbox(impl);
    await outbox.start();
    void outbox.send([newWrite(1)], 1);
    await vi.waitFor(() => expect(outbox.getStatus()).toMatchObject({ pending: 1, sending: 1 }));
    expect(queuedCount(outbox.getStatus())).toBe(0);
    await reply("/api/tasks/t1");
    await settle(outbox);
  });

  it("never shows an online write as queued, at any status change while it is sent and settled", async () => {
    const { impl } = scriptedFetch([{ status: 200, body: {} }]);
    const outbox = makeOutbox(impl);
    await outbox.start();
    const seen: number[] = [];
    outbox.subscribe(() => seen.push(queuedCount(outbox.getStatus())));

    const [answer] = await outbox.send([newWrite(1)], 1);
    await expect(answer).resolves.toMatchObject({ kind: "ok" });
    await settle(outbox);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((n) => n > 0)).toEqual([]);
  });

  it("sends a bulk action's writes together, and a later write only after all of them", async () => {
    const { impl, sent, reply } = heldFetch();
    const outbox = makeOutbox(impl);
    await outbox.start();

    const bulk = await outbox.send([newWrite(1), newWrite(2), newWrite(3)], 1);
    const [later] = await outbox.send([newWrite(4)], 2);
    await vi.waitFor(() =>
      expect([...sent].sort()).toEqual(["/api/tasks/t1", "/api/tasks/t2", "/api/tasks/t3"])
    );
    const stored = await outbox.list();
    expect(new Set(stored.slice(0, 3).map((w) => w.batch)).size).toBe(1);
    expect(stored[0].batch).toBeDefined();
    expect(stored[3].batch).toBeUndefined();

    await reply("/api/tasks/t2");
    await reply("/api/tasks/t3");
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).not.toContain("/api/tasks/t4");
    await reply("/api/tasks/t1");
    await vi.waitFor(() => expect(sent).toContain("/api/tasks/t4"));
    await reply("/api/tasks/t4");

    expect((await Promise.all(bulk)).map((a) => a.kind)).toEqual(["ok", "ok", "ok"]);
    await expect(later).resolves.toMatchObject({ kind: "ok" });
    await settle(outbox);
  });

  it("answers `queued` when the connection drops, keeping the write under its key", async () => {
    const { impl, sent } = scriptedFetch(["network", { status: 200, body: {} }]);
    const outbox = makeOutbox(impl);
    await outbox.start();

    const [answer] = await outbox.send([newWrite(1)], 1);
    await expect(answer).resolves.toEqual({ kind: "queued" });
    expect(outbox.getStatus()).toMatchObject({ pending: 1, sending: 0, state: "waiting" });
    expect(queuedCount(outbox.getStatus())).toBe(1);
    expect(outbox.canSendNow()).toBe(false);

    outbox.setOnline(true);
    await settle(outbox);
    expect(sent.map((s) => s.key)).toEqual(["k1", "k1"]);
    expect(outbox.getStatus().pending).toBe(0);
  });

  it("hands a refusal or server error to the caller, not to sync notices or the stuck state", async () => {
    const { impl } = scriptedFetch([
      { status: 404, body: { error: "Task not found", code: "not_found" } },
      { status: 500, body: { error: "Boom" } },
    ]);
    const outbox = makeOutbox(impl);
    const refusals: Refusal[] = [];
    outbox.subscribeRefusals((r) => refusals.push(r));
    await outbox.start();

    const [refused] = await outbox.send([newWrite(1)], 1);
    const [failed] = await outbox.send([newWrite(2)], 2);
    await expect(refused).resolves.toMatchObject({
      kind: "refused",
      status: 404,
      code: "not_found",
    });
    await expect(failed).resolves.toMatchObject({
      kind: "server-error",
      status: 500,
      message: "Boom",
    });
    await settle(outbox);

    expect(refusals).toEqual([]);
    expect(await outbox.list()).toEqual([]);
    expect(outbox.getStatus()).toMatchObject({ pending: 0, state: "idle", blockedReason: null });
  });

  it("answers a 401 to the caller and asks for sign-in without blocking an empty queue", async () => {
    const { impl } = scriptedFetch([{ status: 401, body: { error: "Unauthorized" } }]);
    const onUnauthorized = vi.fn();
    const outbox = makeOutbox(impl, { onUnauthorized });
    await outbox.start();

    const [answer] = await outbox.send([newWrite(1)], 1);
    await expect(answer).resolves.toMatchObject({ kind: "unauthorized" });
    await settle(outbox);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(outbox.getStatus()).toMatchObject({ pending: 0, state: "idle" });
  });

  it("can't send now behind a backlog or a blocked queue, only behind writes being sent", async () => {
    const { impl } = scriptedFetch([{ status: 500, body: {} }]);
    online = false;
    const outbox = makeOutbox(impl);
    await outbox.start();
    expect(outbox.canSendNow()).toBe(false);

    online = true;
    outbox.setOnline(true);
    expect(outbox.canSendNow()).toBe(true);
    await outbox.enqueue(write(1), 1, "k1");
    expect(outbox.canSendNow()).toBe(false);
  });

  it("stops holding the caller when the server doesn't answer in time, and still reports the outcome later", async () => {
    const { impl, sent, reply } = heldFetch();
    const outbox = makeOutbox(impl, { answerDeadlineMs: 50 });
    const refusals: Refusal[] = [];
    outbox.subscribeRefusals((r) => refusals.push(r));
    await outbox.start();

    const [stalled] = await outbox.send([newWrite(1)], 1);
    await expect(stalled).resolves.toEqual({ kind: "queued" });
    // Now shown as waiting to sync, and the next write no longer waits on the stalled one.
    expect(queuedCount(outbox.getStatus())).toBe(1);
    expect(outbox.canSendNow()).toBe(false);

    await vi.waitFor(() => expect(sent).toEqual(["/api/tasks/t1"]));
    await reply("/api/tasks/t1", 404, { error: "Task not found" });
    await settle(outbox);
    expect(refusals.map((r) => r.status)).toEqual([404]);
    expect(outbox.getStatus()).toMatchObject({ pending: 0, sending: 0 });
  });

  it("answers callers `queued` when stopped mid-send (sign-out, account switch)", async () => {
    const { impl } = heldFetch();
    const outbox = makeOutbox(impl);
    await outbox.start();
    const [answer] = await outbox.send([newWrite(1)], 1);
    await vi.waitFor(() => expect(impl).toHaveBeenCalled());
    outbox.stop();
    await expect(answer).resolves.toEqual({ kind: "queued" });
  });
});

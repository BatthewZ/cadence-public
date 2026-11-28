import { onlineManager, QueryClient } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDEMPOTENCY_KEY_HEADER } from "@/shared/constants/offline-sync";
import { api, ApiError } from "@/web/lib/api/client";

import { isOfflineQueryKey } from "./persisted-queries";
import { activeOutbox, startOfflineRuntime, stopOfflineRuntime, wipeOfflineData } from "./runtime";
import { sendWrite, sendWrites } from "./send-write";

interface Call {
  path: string;
  method: string;
  key: string | null;
}

function stubFetch(handler: (call: Call) => Response | "network") {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const call = {
        path,
        method: init?.method ?? "GET",
        key: new Headers(init?.headers).get(IDEMPOTENCY_KEY_HEADER),
      };
      calls.push(call);
      const reply = handler(call);
      return reply === "network"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(reply);
    })
  );
  return calls;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const rename = {
  method: "PATCH" as const,
  path: "/api/tasks/t1",
  body: { title: "New" },
  label: "Rename task",
};

async function drained() {
  for (let i = 0; i < 20; i++) {
    await activeOutbox()?.whenSettled();
    await new Promise((r) => setTimeout(r, 0));
    const status = activeOutbox()?.getStatus();
    if (status?.state !== "syncing") return;
  }
}

let queryClient: QueryClient;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  onlineManager.setOnline(true);
  queryClient = new QueryClient();
});

afterEach(() => {
  stopOfflineRuntime();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

describe("sendWrite", () => {
  it("is a plain api call when no account is signed in", async () => {
    const spy = vi.spyOn(api, "patch").mockResolvedValue({ ok: true });
    await expect(sendWrite(rename)).resolves.toEqual({ status: "sent", data: { ok: true } });
    expect(spy).toHaveBeenCalledWith("/api/tasks/t1", { title: "New" });
    spy.mockRestore();
  });

  it("sends online writes now, with an idempotency key", async () => {
    const calls = stubFetch(() => json(200, { task: { id: "t1" } }));
    await startOfflineRuntime("u1", queryClient);

    await expect(sendWrite(rename)).resolves.toEqual({
      status: "sent",
      data: { task: { id: "t1" } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("throws the server's refusal with its code, as api.* does", async () => {
    stubFetch(() => json(409, { error: "Changed", code: "description_conflict" }));
    await startOfflineRuntime("u1", queryClient);

    const error = await sendWrite(rename).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "description_conflict", message: "Changed" });
  });

  it("queues when the connection drops mid-request and replays under the same key", async () => {
    let up = false;
    const calls = stubFetch(() => (up ? json(200, {}) : "network"));
    await startOfflineRuntime("u1", queryClient);

    await expect(sendWrite(rename)).resolves.toEqual({ status: "queued" });
    await drained();
    expect(activeOutbox()!.getStatus().pending).toBe(1);

    up = true;
    activeOutbox()!.setOnline(true);
    await drained();
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.key)).toEqual([
      calls[0].key,
      calls[0].key,
    ]);
    expect(activeOutbox()!.getStatus().pending).toBe(0);
  });

  it("queues while offline, behind earlier writes, and drains in order when back online", async () => {
    const calls = stubFetch(() => json(200, {}));
    await startOfflineRuntime("u1", queryClient);
    onlineManager.setOnline(false);

    await sendWrite({ ...rename, path: "/api/tasks/a" });
    await sendWrite({ ...rename, path: "/api/tasks/b" });
    expect(calls).toHaveLength(0);

    onlineManager.setOnline(true);
    await expect(sendWrite({ ...rename, path: "/api/tasks/c" })).resolves.toEqual({
      status: "queued",
    });
    await drained();
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.path)).toEqual([
      "/api/tasks/a",
      "/api/tasks/b",
      "/api/tasks/c",
    ]);
  });

  it("sends an edit made right after a create only once the create is answered", async () => {
    // The create is slow and the edit fast: sent side by side, the edit would reach the server first and 404.
    const order: string[] = [];
    let releaseCreate: () => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, init?: RequestInit) => {
        order.push(`${init?.method} ${path}`);
        if (init?.method === "POST") {
          return new Promise<Response>((resolve) => {
            releaseCreate = () => resolve(json(201, { task: { id: "t-new" } }));
          });
        }
        return Promise.resolve(json(200, { task: { id: "t-new", title: "Renamed" } }));
      })
    );
    await startOfflineRuntime("u1", queryClient);

    const create = sendWrite({
      method: "POST",
      path: "/api/tasks",
      body: { id: "t-new" },
      label: "Create task",
    });
    const edit = sendWrite({ ...rename, path: "/api/tasks/t-new" });
    await vi.waitFor(() => expect(order).toEqual(["POST /api/tasks"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["POST /api/tasks"]);

    releaseCreate();
    await expect(create).resolves.toEqual({ status: "sent", data: { task: { id: "t-new" } } });
    await expect(edit).resolves.toEqual({
      status: "sent",
      data: { task: { id: "t-new", title: "Renamed" } },
    });
    expect(order).toEqual(["POST /api/tasks", "PATCH /api/tasks/t-new"]);
  });

  it("keeps a write whose send was cut off by a reload, and sends it once under the same key", async () => {
    const keys: (string | null)[] = [];
    let land = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((_path: string, init?: RequestInit) => {
        keys.push(new Headers(init?.headers).get(IDEMPOTENCY_KEY_HEADER));
        // Before the reload the request never completes; after it, the server answers.
        return land ? Promise.resolve(json(200, {})) : new Promise<Response>(() => undefined);
      })
    );
    await startOfflineRuntime("u1", queryClient);
    const pending = sendWrite(rename);
    await vi.waitFor(() => expect(keys).toHaveLength(1));

    stopOfflineRuntime();
    await expect(pending).resolves.toEqual({ status: "queued" });
    await new Promise((r) => setTimeout(r, 20));

    land = true;
    await startOfflineRuntime("u1", new QueryClient());
    await drained();
    expect(keys).toEqual([keys[0], keys[0]]);
    expect(activeOutbox()!.getStatus().pending).toBe(0);
  });

  it("stores a bulk action made offline as one batch, replayed behind earlier writes", async () => {
    const calls = stubFetch(() => json(200, {}));
    await startOfflineRuntime("u1", queryClient);
    onlineManager.setOnline(false);

    await sendWrite({ ...rename, path: "/api/tasks/first" });
    const results = await Promise.all(
      sendWrites([
        { ...rename, path: "/api/tasks/a" },
        { ...rename, path: "/api/tasks/b" },
      ])
    );
    expect(results).toEqual([{ status: "queued" }, { status: "queued" }]);
    const stored = await activeOutbox()!.list();
    expect(stored.map((w) => w.path)).toEqual(["/api/tasks/first", "/api/tasks/a", "/api/tasks/b"]);
    expect(stored[0].batch).toBeUndefined();
    expect(stored[1].batch).toBeDefined();
    expect(stored[2].batch).toBe(stored[1].batch);

    onlineManager.setOnline(true);
    await drained();
    const sent = calls.filter((c) => c.method === "PATCH").map((c) => c.path);
    expect(sent[0]).toBe("/api/tasks/first");
    expect(sent.slice(1).sort()).toEqual(["/api/tasks/a", "/api/tasks/b"]);
  });

  it("restores saved reads for the same account after a reload, and none after a wipe", async () => {
    stubFetch(() => json(200, {}));
    await startOfflineRuntime("u1", queryClient);
    queryClient.setQueryData(["projects", "p1", "tasks"], { tasks: [{ id: "t1" }] });
    queryClient.setQueryData(["workspaces", "w1", "search", "secret"], { results: [] });
    stopOfflineRuntime();
    await new Promise((r) => setTimeout(r, 20));

    const reloaded = new QueryClient();
    await startOfflineRuntime("u1", reloaded);
    expect(reloaded.getQueryData(["projects", "p1", "tasks"])).toEqual({ tasks: [{ id: "t1" }] });
    expect(reloaded.getQueryData(["workspaces", "w1", "search", "secret"])).toBeUndefined();

    await wipeOfflineData("u1");
    const afterWipe = new QueryClient();
    await startOfflineRuntime("u1", afterWipe);
    expect(afterWipe.getQueryData(["projects", "p1", "tasks"])).toBeUndefined();
  });
});

describe("isOfflineQueryKey", () => {
  it.each([
    [["workspaces"], true],
    [["workspaces", "w1"], true],
    [["workspaces", "w1", "projects"], true],
    [["workspaces", "w1", "dashboard", "my-tasks", "all", "", "", {}], true],
    [["projects", "p1"], true],
    [["projects", "p1", "tasks"], true],
    [["projects", "p1", "saved-views"], true],
    [["tasks", "t1"], true],
    [["tasks", "t1", "comments"], true],
    [["legal", "tos-status"], true],
    [["config", "features"], true],
    [["workspaces", "w1", "search", "q"], false],
    [["workspaces", "w1", "webhooks"], false],
    [["workspaces", "w1", "api-tokens"], false],
    [["workspaces", "w1", "calendar-feed"], false],
    [["workspaces", "w1", "activity"], false],
    [["projects", "p1", "activity"], false],
    [["tasks", "t1", "activity"], false],
    [["notifications", "list"], false],
    [["freshness", "project", "p1"], false],
    [["invitations", "pending"], false],
  ])("%j → %s", (key, expected) => {
    expect(isOfflineQueryKey(key)).toBe(expected);
  });
});

/**
 * The sync hooks follow whichever account's queue is active: they mount before sign-in (no
 * queue yet), must attach once the runtime boots, and must re-attach to the new queue on an
 * account switch rather than keep listening to the stopped one. Real runtime, real IndexedDB.
 */
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSyncRefusals, useSyncStatus } from "./hooks";
import type { Refusal } from "./outbox";
import { activeOutbox, startOfflineRuntime, stopOfflineRuntime } from "./runtime";
import { sendWrite } from "./send-write";

const rename = (title: string) => ({
  method: "PATCH" as const,
  path: "/api/tasks/t1",
  body: { title },
  label: `Rename to “${title}”`,
});

let queryClient: QueryClient;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Task not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      )
    )
  );
  onlineManager.setOnline(true);
  queryClient = new QueryClient();
});

afterEach(() => {
  act(() => stopOfflineRuntime());
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

async function queueOffline(title: string) {
  act(() => onlineManager.setOnline(false));
  await act(() => sendWrite(rename(title)));
}

describe("useSyncStatus", () => {
  it("reads an idle queue before sign-in, then follows each account's queue in turn", async () => {
    const { result } = renderHook(() => useSyncStatus());
    expect(result.current).toMatchObject({ pending: 0, state: "idle" });

    await act(() => startOfflineRuntime("u1", queryClient));
    await queueOffline("u1 edit");
    await waitFor(() => expect(result.current.pending).toBe(1));

    await act(() => startOfflineRuntime("u2", queryClient));
    expect(result.current.pending).toBe(0);
    await queueOffline("u2 edit one");
    await queueOffline("u2 edit two");
    await waitFor(() => expect(result.current.pending).toBe(2));

    act(() => stopOfflineRuntime());
    expect(result.current).toMatchObject({ pending: 0, state: "idle" });
  });
});

describe("useSyncRefusals", () => {
  it("reports refusals from the queue booted after mount, and from the next account's after a switch", async () => {
    const onRefusal = vi.fn<(refusal: Refusal) => void>();
    const { unmount } = renderHook(() => useSyncRefusals(onRefusal));

    await act(() => startOfflineRuntime("u1", queryClient));
    await queueOffline("u1 edit");
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(onRefusal).toHaveBeenCalledTimes(1));
    expect(onRefusal.mock.calls[0][0]).toMatchObject({
      status: 404,
      write: { label: "Rename to “u1 edit”" },
    });

    await act(() => startOfflineRuntime("u2", queryClient));
    await queueOffline("u2 edit");
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(onRefusal).toHaveBeenCalledTimes(2));
    expect(onRefusal.mock.calls[1][0]).toMatchObject({
      status: 404,
      write: { label: "Rename to “u2 edit”" },
    });

    unmount();
    await queueOffline("after unmount");
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(activeOutbox()!.getStatus().pending).toBe(0));
    expect(onRefusal).toHaveBeenCalledTimes(2);
  });
});

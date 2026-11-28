import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { queryKeys } from "@/web/lib/query-keys";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

import { useLocalTask } from "./use-local-task";

const KEY = queryKeys.tasks.detail("t-1");
const seed = { id: "t-1", title: "Fix login", subtasks: [] } as unknown as TaskDetail;

async function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  queryClient.setQueryData(KEY, { task: seed });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = () =>
    renderHook(
      () => {
        const { data } = useQuery<{ task: TaskDetail }>({
          queryKey: KEY,
          queryFn: () => new Promise(() => {}),
          enabled: false,
        });
        return useLocalTask("t-1", data?.task);
      },
      { wrapper }
    );
  const first = view();
  await act(async () => {});
  return { queryClient, view, result: first.result, unmount: first.unmount };
}

const saved = (qc: QueryClient) => qc.getQueryData<{ task: TaskDetail }>(KEY)?.task;

describe("useLocalTask", () => {
  it("writes an edit to the detail query too, so a view opened afterwards starts from it", async () => {
    const { queryClient, view, result, unmount } = await setup();

    act(() => result.current.setLocalTask((prev) => (prev ? { ...prev, title: "Renamed" } : prev)));
    expect(result.current.localTask?.title).toBe("Renamed");
    expect(saved(queryClient)?.title).toBe("Renamed");

    unmount();
    const reopened = view();
    await act(async () => {});
    expect(reopened.result.current.localTask?.title).toBe("Renamed");
  });

  it("leaves the detail query alone when reseeding, clearing, or when nothing changed", async () => {
    const { queryClient, result } = await setup();
    const before = queryClient.getQueryState(KEY)?.dataUpdatedAt;

    act(() => result.current.resetLocalTask({ ...seed, title: "Only here" }));
    act(() => result.current.setLocalTask(null));
    act(() => result.current.setLocalTask((prev) => prev));

    expect(saved(queryClient)).toBe(seed);
    // Untouched, so a stale query still refetches as before.
    expect(queryClient.getQueryState(KEY)?.dataUpdatedAt).toBe(before);
  });

  it("keeps the view's edit when the detail query isn't cached", async () => {
    const { queryClient, result } = await setup();
    queryClient.removeQueries({ queryKey: KEY });

    act(() => result.current.setLocalTask((prev) => (prev ? { ...prev, title: "Local" } : prev)));
    expect(result.current.localTask?.title).toBe("Local");
    expect(saved(queryClient)).toBeUndefined();
  });
});

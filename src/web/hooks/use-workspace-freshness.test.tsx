/**
 * Tests for the workspace freshness poller.
 *
 * Why these matter: Dashboard and MyTasks open TaskDetailDialog, which reads the
 * per-task `tasks.detail` cache entry — a different key from the dashboard list
 * queries this hook was invalidating. So a dialog opened from either surface
 * froze on load while the lists around it kept updating, which reads as "live
 * updates stopped the moment I opened the task". The `tasks.all` assertion is
 * the guard for that; the rest pin the cost controls (baseline poll, suppression,
 * the single-member gate) whose loss turns a 3s poll into a 3s refetch loop.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { queryKeys } from "@/web/lib/query-keys";

vi.mock("@/web/lib/api/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/web/lib/api/client")>(
      "@/web/lib/api/client",
    );
  return {
    ...actual,
    api: Object.assign(vi.fn(), {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

vi.mock("@/web/lib/poll-interval", () => ({
  jitteredInterval: vi.fn(() => () => 1_000_000),
}));

import { api } from "@/web/lib/api/client";
import { jitteredInterval } from "@/web/lib/poll-interval";

import { useWorkspaceFreshness } from "./use-workspace-freshness";

const mockGet = api.get as ReturnType<typeof vi.fn>;
const mockJitteredInterval = jitteredInterval as ReturnType<typeof vi.fn>;

const WORKSPACE_ID = "ws-1";
const FRESHNESS_KEY = queryKeys.freshness.workspace(WORKSPACE_ID);

let qc: QueryClient;
let invalidateSpy: ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function invalidatedKeys(): string[] {
  return invalidateSpy.mock.calls.map((call: unknown[]) =>
    JSON.stringify((call[0] as { queryKey: unknown } | undefined)?.queryKey),
  );
}

type Payload = {
  workspace: number | null;
  projects: number | null;
  tasks: number | null;
};

/** See use-project-freshness.test.tsx for why this flush is required. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function nextPoll(freshness: Payload) {
  mockGet.mockResolvedValue({ freshness });
  await act(async () => {
    await qc.refetchQueries({ queryKey: FRESHNESS_KEY });
  });
  await flush();
}

async function mountWithBaseline(multiUser = true) {
  const view = renderHook(
    () => useWorkspaceFreshness(WORKSPACE_ID, multiUser),
    { wrapper },
  );
  if (multiUser) {
    await waitFor(() => expect(qc.getQueryData(FRESHNESS_KEY)).toBeDefined());
  }
  await flush();
  return view;
}

beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  vi.spyOn(freshnessTracker, "shouldInvalidate").mockReturnValue(true);
  mockGet.mockResolvedValue({
    freshness: { workspace: 100, projects: 200, tasks: 300 },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  qc.clear();
});

describe("useWorkspaceFreshness", () => {
  it("does not poll in a single-member workspace", async () => {
    await mountWithBaseline(false);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockJitteredInterval).not.toHaveBeenCalled();
  });

  it("jitters the poll interval around the documented 3s base", async () => {
    await mountWithBaseline();
    expect(mockGet).toHaveBeenCalledWith(
      `/api/workspaces/${WORKSPACE_ID}/freshness`,
    );
    expect(mockJitteredInterval).toHaveBeenCalledWith(3000);
  });

  it("records the baseline poll without invalidating", async () => {
    await mountWithBaseline();
    expect(invalidatedKeys()).toEqual([]);
  });

  it("invalidates the dashboard lists AND any open task dialog on a task change", async () => {
    await mountWithBaseline();
    await nextPoll({ workspace: 100, projects: 200, tasks: 999 });

    const keys = invalidatedKeys();
    expect(keys).toContain(
      JSON.stringify(queryKeys.workspaces.dashboard(WORKSPACE_ID)),
    );
    expect(keys).toContain(
      JSON.stringify(queryKeys.workspaces.dashboardMyTasksPrefix(WORKSPACE_ID)),
    );
    expect(keys).toContain(
      JSON.stringify(queryKeys.workspaces.dashboardUpcoming(WORKSPACE_ID)),
    );
    // The regression guard for a dialog opened from Dashboard or MyTasks.
    expect(keys).toContain(JSON.stringify(queryKeys.tasks.all));
  });

  it("does not touch task caches on a projects-only change", async () => {
    await mountWithBaseline();
    await nextPoll({ workspace: 100, projects: 999, tasks: 300 });

    const keys = invalidatedKeys();
    expect(keys).toContain(
      JSON.stringify(queryKeys.workspaces.projects(WORKSPACE_ID)),
    );
    expect(keys).not.toContain(JSON.stringify(queryKeys.tasks.all));
  });

  it("invalidates workspace detail and members on a workspace change", async () => {
    await mountWithBaseline();
    await nextPoll({ workspace: 999, projects: 200, tasks: 300 });

    const keys = invalidatedKeys();
    expect(keys).toContain(
      JSON.stringify(queryKeys.workspaces.detail(WORKSPACE_ID)),
    );
    expect(keys).toContain(
      JSON.stringify(queryKeys.workspaces.members(WORKSPACE_ID)),
    );
  });

  it("respects self-mutation suppression", async () => {
    await mountWithBaseline();
    (
      freshnessTracker.shouldInvalidate as ReturnType<typeof vi.fn>
    ).mockReturnValue(false);

    await nextPoll({ workspace: 999, projects: 999, tasks: 999 });
    expect(invalidatedKeys()).toEqual([]);
  });

  it("treats null timestamps as no-change", async () => {
    await mountWithBaseline();
    await nextPoll({ workspace: 100, projects: null, tasks: null });
    expect(invalidatedKeys()).toEqual([]);
  });
});

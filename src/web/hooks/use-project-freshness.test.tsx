/**
 * Tests for the project freshness poller.
 *
 * Why these matter: this hook is the ONLY thing that propagates a collaborator's
 * change into another member's open project, and every failure mode is silent —
 * a missed invalidation target doesn't throw, doesn't log, and doesn't fail a
 * typecheck. It just quietly freezes someone's screen. The suite therefore pins
 * the invalidation TARGETS rather than the fact that polling happens:
 *
 * - `tasks.all` alongside `projects.tasks`: the board list and an open detail
 *   panel are separate cache entries. Invalidating only the list was the bug
 *   that left a panel frozen on whatever it held when it opened, because the
 *   freshness payload is one MAX(updatedAt) for the project and cannot name the
 *   task that changed.
 * - The first poll must NOT invalidate: it establishes the baseline. Firing on
 *   it would make every mount stampede the API with a full refetch.
 * - Suppression and the multi-user gate are cost controls; losing either turns a
 *   1.5s poll into a 1.5s full-refetch loop for every viewer.
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

// Real jitter maths are covered in poll-interval.test.ts. Here we only care that
// the hook wires it up at the documented base — and we pin the interval far out
// so background polls can't race the assertions.
vi.mock("@/web/lib/poll-interval", () => ({
  jitteredInterval: vi.fn(() => () => 1_000_000),
}));

import { api } from "@/web/lib/api/client";
import { jitteredInterval } from "@/web/lib/poll-interval";

import { useProjectFreshness } from "./use-project-freshness";

const mockGet = api.get as ReturnType<typeof vi.fn>;
const mockJitteredInterval = jitteredInterval as ReturnType<typeof vi.fn>;

const PROJECT_ID = "proj-1";
const FRESHNESS_KEY = queryKeys.freshness.project(PROJECT_ID);

let qc: QueryClient;
let invalidateSpy: ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Keys passed to invalidateQueries, flattened for readable assertions. */
function invalidatedKeys(): string[] {
  return invalidateSpy.mock.calls.map((call: unknown[]) =>
    JSON.stringify((call[0] as { queryKey: unknown } | undefined)?.queryKey),
  );
}

function poll(freshness: {
  project: number | null;
  tasks: number | null;
  taskGroups: number | null;
}) {
  mockGet.mockResolvedValue({ freshness });
}

/**
 * Let TanStack's notification scheduler, the re-render, and the resulting effect
 * all settle. Awaiting only the refetch promise is not enough — the cache write
 * lands before React has re-rendered, so assertions made straight after it race
 * the very effect under test (observed as intermittent failures).
 */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Simulate the next poll landing with a new payload. */
async function nextPoll(freshness: {
  project: number | null;
  tasks: number | null;
  taskGroups: number | null;
}) {
  poll(freshness);
  await act(async () => {
    await qc.refetchQueries({ queryKey: FRESHNESS_KEY });
  });
  await flush();
}

/** Mount the hook and let the baseline poll settle. */
async function mountWithBaseline(multiUser = true) {
  const view = renderHook(() => useProjectFreshness(PROJECT_ID, multiUser), {
    wrapper,
  });
  if (multiUser) {
    await waitFor(() => expect(qc.getQueryData(FRESHNESS_KEY)).toBeDefined());
  }
  // Deliberately NOT clearing invalidateSpy here: the baseline genuinely must
  // record without invalidating, and clearing would make that test unfalsifiable.
  await flush();
  return view;
}

beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  vi.spyOn(freshnessTracker, "shouldInvalidate").mockReturnValue(true);
  poll({ project: 100, tasks: 200, taskGroups: 300 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  qc.clear();
});

describe("useProjectFreshness", () => {
  describe("polling gate", () => {
    it("does not poll at all in a single-member workspace", async () => {
      await mountWithBaseline(false);
      // Give any stray effect a chance to fire before asserting the negative.
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("does not poll without a project id", async () => {
      renderHook(() => useProjectFreshness("", true), { wrapper });
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("polls the project freshness endpoint when multi-member", async () => {
      await mountWithBaseline();
      expect(mockGet).toHaveBeenCalledWith(
        `/api/projects/${PROJECT_ID}/freshness`,
      );
    });

    it("jitters the poll interval around the documented 1.5s base", async () => {
      await mountWithBaseline();
      expect(mockJitteredInterval).toHaveBeenCalledWith(1500);
    });

    it("does not build an interval when polling is disabled", async () => {
      await mountWithBaseline(false);
      expect(mockJitteredInterval).not.toHaveBeenCalled();
    });
  });

  describe("baseline poll", () => {
    it("records timestamps without invalidating anything", async () => {
      await mountWithBaseline();
      expect(invalidatedKeys()).toEqual([]);
    });

    it("does not invalidate when nothing changed between polls", async () => {
      await mountWithBaseline();
      await nextPoll({ project: 100, tasks: 200, taskGroups: 300 });
      expect(invalidatedKeys()).toEqual([]);
    });
  });

  describe("task changes", () => {
    it("invalidates BOTH the board list and any open task detail", async () => {
      await mountWithBaseline();
      await nextPoll({ project: 100, tasks: 999, taskGroups: 300 });

      const keys = invalidatedKeys();
      expect(keys).toContain(
        JSON.stringify(queryKeys.projects.tasks(PROJECT_ID)),
      );
      // The regression guard: without this the open panel never refetches.
      expect(keys).toContain(JSON.stringify(queryKeys.tasks.all));
    });

    it("leaves project and task-group caches alone", async () => {
      await mountWithBaseline();
      await nextPoll({ project: 100, tasks: 999, taskGroups: 300 });

      const keys = invalidatedKeys();
      expect(keys).not.toContain(
        JSON.stringify(queryKeys.projects.detail(PROJECT_ID)),
      );
      expect(keys).not.toContain(
        JSON.stringify(queryKeys.projects.taskGroups(PROJECT_ID)),
      );
    });

    it("keeps firing across consecutive changes", async () => {
      await mountWithBaseline();
      await nextPoll({ project: 100, tasks: 999, taskGroups: 300 });
      invalidateSpy.mockClear();

      await nextPoll({ project: 100, tasks: 1000, taskGroups: 300 });
      expect(invalidatedKeys()).toContain(JSON.stringify(queryKeys.tasks.all));
    });
  });

  describe("project changes", () => {
    it("invalidates detail, members and labels", async () => {
      await mountWithBaseline();
      await nextPoll({ project: 999, tasks: 200, taskGroups: 300 });

      const keys = invalidatedKeys();
      expect(keys).toContain(
        JSON.stringify(queryKeys.projects.detail(PROJECT_ID)),
      );
      expect(keys).toContain(
        JSON.stringify(queryKeys.projects.members(PROJECT_ID)),
      );
      expect(keys).toContain(
        JSON.stringify(queryKeys.projects.labels(PROJECT_ID)),
      );
    });
  });

  describe("task group changes", () => {
    it("invalidates the task group list", async () => {
      await mountWithBaseline();
      await nextPoll({ project: 100, tasks: 200, taskGroups: 999 });

      expect(invalidatedKeys()).toContain(
        JSON.stringify(queryKeys.projects.taskGroups(PROJECT_ID)),
      );
    });
  });

  describe("self-mutation suppression", () => {
    it("skips invalidation while the tracker is suppressing", async () => {
      await mountWithBaseline();
      (
        freshnessTracker.shouldInvalidate as ReturnType<typeof vi.fn>
      ).mockReturnValue(false);

      await nextPoll({ project: 999, tasks: 999, taskGroups: 999 });
      expect(invalidatedKeys()).toEqual([]);
    });

    it("still advances the baseline so the change is not replayed later", async () => {
      await mountWithBaseline();
      (
        freshnessTracker.shouldInvalidate as ReturnType<typeof vi.fn>
      ).mockReturnValue(false);
      await nextPoll({ project: 100, tasks: 999, taskGroups: 300 });

      (
        freshnessTracker.shouldInvalidate as ReturnType<typeof vi.fn>
      ).mockReturnValue(true);
      await nextPoll({ project: 100, tasks: 999, taskGroups: 300 });

      expect(invalidatedKeys()).toEqual([]);
    });
  });

  describe("degenerate payloads", () => {
    it("treats null timestamps as no-change rather than a change", async () => {
      // An empty project reports null for tasks/taskGroups on every poll; a
      // null-vs-number comparison would otherwise invalidate forever.
      await mountWithBaseline();
      await nextPoll({ project: 100, tasks: null, taskGroups: null });
      expect(invalidatedKeys()).toEqual([]);
    });

    it("invalidates once a null becomes a real timestamp", async () => {
      poll({ project: 100, tasks: null, taskGroups: null });
      await mountWithBaseline();

      await nextPoll({ project: 100, tasks: 500, taskGroups: null });
      expect(invalidatedKeys()).toContain(JSON.stringify(queryKeys.tasks.all));
    });
  });
});

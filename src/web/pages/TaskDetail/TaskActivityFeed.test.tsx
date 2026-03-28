import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityItem } from "@/web/util/activity";

import { TaskActivityFeed } from "./TaskActivityFeed";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>(
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

import { api } from "@/web/lib/api/client";
const mockGet = api.get as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ActivityPage {
  activities: ActivityItem[];
  nextCursor: string | null;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function makeActivity(overrides: Partial<ActivityItem> & { id: string }): ActivityItem {
  return {
    taskId: "task-1",
    actorId: "user-1",
    actorName: "Alice",
    actorImage: null,
    action: "created",
    field: null,
    oldValue: null,
    newValue: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const MEMBERS = [
  { id: "user-1", userId: "user-1", role: "admin" as const, user: { id: "user-1", name: "Alice", email: "alice@test.com", image: undefined } },
];

/**
 * Tests for the TaskActivityFeed component which renders paginated activity
 * items with expand/collapse and server-side load-more. Regressions here
 * break the activity timeline on the task detail view.
 */
describe("TaskActivityFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeletons initially", () => {
    mockGet.mockReturnValue(new Promise(() => {})); // never resolves
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <TaskActivityFeed taskId="task-1" members={MEMBERS} />
      </Wrapper>,
    );
    // Skeleton elements render sr-only "Loading" text
    const loadingElements = screen.getAllByText("Loading");
    expect(loadingElements.length).toBeGreaterThan(0);
  });

  it("renders empty state when no activity exists", async () => {
    const emptyPage: ActivityPage = { activities: [], nextCursor: null };
    mockGet.mockResolvedValueOnce(emptyPage);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <TaskActivityFeed taskId="task-1" members={MEMBERS} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("No activity yet")).toBeInTheDocument();
    });
  });

  it("renders initial activity items (up to INITIAL_LIMIT visible)", async () => {
    // INITIAL_LIMIT is 4, query fetches INITIAL_LIMIT + 1 = 5
    const activities = Array.from({ length: 5 }, (_, i) =>
      makeActivity({
        id: `act-${i}`,
        action: i === 0 ? "created" : "title_changed",
        actorName: "Alice",
        createdAt: new Date(2025, 0, 1, i).toISOString(),
      }),
    );

    const page: ActivityPage = { activities, nextCursor: null };
    mockGet.mockResolvedValueOnce(page);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <TaskActivityFeed taskId="task-1" members={MEMBERS} />
      </Wrapper>,
    );

    // Wait for data to load - should show only 4 items initially (INITIAL_LIMIT)
    await waitFor(() => {
      // 5 activities total, only 4 visible initially
      const aliceElements = screen.getAllByText("Alice");
      expect(aliceElements.length).toBe(4);
    });
  });

  it('shows "Show N more" text when more items than INITIAL_LIMIT exist', async () => {
    const activities = Array.from({ length: 5 }, (_, i) =>
      makeActivity({
        id: `act-${i}`,
        actorName: "Alice",
        createdAt: new Date(2025, 0, 1, i).toISOString(),
      }),
    );

    const page: ActivityPage = { activities, nextCursor: null };
    mockGet.mockResolvedValueOnce(page);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <TaskActivityFeed taskId="task-1" members={MEMBERS} />
      </Wrapper>,
    );

    await waitFor(() => {
      // Should show "Show 1 more activity" (5 - 4 = 1)
      expect(screen.getByText(/Show 1 more activity/)).toBeInTheDocument();
    });
  });

  it("expands to show all activities when toggle is clicked", async () => {
    const activities = Array.from({ length: 6 }, (_, i) =>
      makeActivity({
        id: `act-${i}`,
        actorName: "Alice",
        createdAt: new Date(2025, 0, 1, i).toISOString(),
      }),
    );

    const page: ActivityPage = { activities, nextCursor: null };
    mockGet.mockResolvedValueOnce(page);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <TaskActivityFeed taskId="task-1" members={MEMBERS} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Show 2 more activities/)).toBeInTheDocument();
    });

    // Click to expand
    const user = userEvent.setup();
    await user.click(screen.getByText(/Show 2 more activities/));

    // After expanding, all 6 should be visible
    await waitFor(() => {
      const aliceElements = screen.getAllByText("Alice");
      expect(aliceElements.length).toBe(6);
    });

    // Should now show "Show less"
    expect(screen.getByText("Show less")).toBeInTheDocument();
  });

  it('shows "Load more activity" button when hasNextPage and expanded', async () => {
    const activities = Array.from({ length: 5 }, (_, i) =>
      makeActivity({
        id: `act-${i}`,
        actorName: "Alice",
        createdAt: new Date(2025, 0, 1, i).toISOString(),
      }),
    );

    const page1: ActivityPage = {
      activities,
      nextCursor: "2025-01-01T04:00:00.000Z",
    };
    mockGet.mockResolvedValueOnce(page1);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <TaskActivityFeed taskId="task-1" members={MEMBERS} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Show 1 more/)).toBeInTheDocument();
    });

    // Expand first
    const user = userEvent.setup();
    await user.click(screen.getByText(/Show 1 more/));

    // Now the "Load more activity" button should appear
    await waitFor(() => {
      expect(screen.getByText("Load more activity")).toBeInTheDocument();
    });
  });

  it("does not show collapse toggle when items fit within INITIAL_LIMIT", async () => {
    const activities = Array.from({ length: 3 }, (_, i) =>
      makeActivity({
        id: `act-${i}`,
        actorName: "Alice",
        createdAt: new Date(2025, 0, 1, i).toISOString(),
      }),
    );

    const page: ActivityPage = { activities, nextCursor: null };
    mockGet.mockResolvedValueOnce(page);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <TaskActivityFeed taskId="task-1" members={MEMBERS} />
      </Wrapper>,
    );

    await waitFor(() => {
      const aliceElements = screen.getAllByText("Alice");
      expect(aliceElements.length).toBe(3);
    });

    // No expand/collapse toggle needed
    expect(screen.queryByText(/Show.*more/)).toBeNull();
    expect(screen.queryByText("Show less")).toBeNull();
  });
});

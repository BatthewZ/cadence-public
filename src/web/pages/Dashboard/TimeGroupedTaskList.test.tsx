import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that depend on them
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

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws-1", name: "Test Workspace", slug: "test" },
    projects: [{ id: "proj-1", name: "Test Project" }],
    members: [],
    teams: [],
    refetch: vi.fn(),
  }),
}));

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/web/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "user-1", name: "Alice", email: "alice@test.com", image: null } },
  }),
}));

import { api } from "@/web/lib/api/client";
const mockGet = api.get as ReturnType<typeof vi.fn>;

// Polyfill browser APIs missing in jsdom
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;

// Polyfill window.matchMedia for jsdom (used by use-reduced-motion hook)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Dynamically import Dashboard so mocks are ready
const { default: Dashboard } = await import("./Dashboard");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DashboardTaskRaw {
  id: string;
  title: string;
  completed: boolean;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  dueDate: string | null;
  projectId: string;
  projectName: string;
}

interface UpcomingResponse {
  buckets: Record<string, DashboardTaskRaw[]>;
  nextCursor: string | null;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function makeTask(id: string, title: string, dueDate: string | null = null): DashboardTaskRaw {
  return {
    id,
    title,
    completed: false,
    priority: "medium",
    dueDate,
    projectId: "proj-1",
    projectName: "Test Project",
  };
}

/**
 * Tests for the TimeGroupedTaskList sub-component within Dashboard.
 * This tests the upcoming tasks pagination UX including bucket rendering,
 * bucket merging across pages, and load-more behavior. Regressions here
 * break the dashboard's primary upcoming tasks view.
 */
describe("Dashboard — TimeGroupedTaskList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders tasks grouped into correct time buckets", async () => {
    const upcomingResponse: UpcomingResponse = {
      buckets: {
        overdue: [makeTask("t1", "Overdue task", "2020-01-01")],
        today: [makeTask("t2", "Today task", "2025-01-15")],
        this_week: [makeTask("t3", "This week task", "2025-01-17")],
      },
      nextCursor: null,
    };

    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/dashboard/upcoming")) {
        return Promise.resolve(upcomingResponse);
      }
      if (url.includes("/dashboard/my-tasks")) {
        return Promise.resolve({ tasks: [], nextCursor: null });
      }
      if (url.includes("/activity")) {
        return Promise.resolve({ activities: [], nextCursor: null });
      }
      if (url.includes("/projects")) {
        return Promise.resolve({ projects: [{ id: "proj-1", name: "Test Project" }] });
      }
      return Promise.resolve({});
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Dashboard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Overdue")).toBeInTheDocument();
      expect(screen.getByText("Today")).toBeInTheDocument();
      expect(screen.getByText("This Week")).toBeInTheDocument();
    });
  });

  it('shows "Load more tasks" button when hasNextPage is true', async () => {
    const upcomingResponse: UpcomingResponse = {
      buckets: {
        today: [makeTask("t1", "Task 1", "2025-01-15")],
      },
      nextCursor: "2025-01-15|t1",
    };

    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/dashboard/upcoming")) {
        return Promise.resolve(upcomingResponse);
      }
      if (url.includes("/dashboard/my-tasks")) {
        return Promise.resolve({ tasks: [], nextCursor: null });
      }
      if (url.includes("/activity")) {
        return Promise.resolve({ activities: [], nextCursor: null });
      }
      if (url.includes("/projects")) {
        return Promise.resolve({ projects: [{ id: "proj-1", name: "Test Project" }] });
      }
      return Promise.resolve({});
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Dashboard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Load more tasks")).toBeInTheDocument();
    });
  });

  it('hides "Load more tasks" when no more pages', async () => {
    const upcomingResponse: UpcomingResponse = {
      buckets: {
        today: [makeTask("t1", "Only task", "2025-01-15")],
      },
      nextCursor: null,
    };

    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/dashboard/upcoming")) {
        return Promise.resolve(upcomingResponse);
      }
      if (url.includes("/dashboard/my-tasks")) {
        return Promise.resolve({ tasks: [], nextCursor: null });
      }
      if (url.includes("/activity")) {
        return Promise.resolve({ activities: [], nextCursor: null });
      }
      if (url.includes("/projects")) {
        return Promise.resolve({ projects: [{ id: "proj-1", name: "Test Project" }] });
      }
      return Promise.resolve({});
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Dashboard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Today")).toBeInTheDocument();
    });

    expect(screen.queryByText("Load more tasks")).toBeNull();
  });

  it("renders empty state when all buckets are empty", async () => {
    const upcomingResponse: UpcomingResponse = {
      buckets: {},
      nextCursor: null,
    };

    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/dashboard/upcoming")) {
        return Promise.resolve(upcomingResponse);
      }
      if (url.includes("/dashboard/my-tasks")) {
        return Promise.resolve({ tasks: [], nextCursor: null });
      }
      if (url.includes("/activity")) {
        return Promise.resolve({ activities: [], nextCursor: null });
      }
      if (url.includes("/projects")) {
        return Promise.resolve({ projects: [{ id: "proj-1", name: "Test Project" }] });
      }
      return Promise.resolve({});
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Dashboard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("No upcoming tasks")).toBeInTheDocument();
    });
  });

  it("clicking load more fetches next page", async () => {
    let callCount = 0;
    const page1: UpcomingResponse = {
      buckets: {
        today: [makeTask("t1", "Page 1 task", "2025-01-15")],
      },
      nextCursor: "2025-01-15|t1",
    };
    const page2: UpcomingResponse = {
      buckets: {
        this_week: [makeTask("t2", "Page 2 task", "2025-01-17")],
      },
      nextCursor: null,
    };

    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/dashboard/upcoming")) {
        callCount++;
        return Promise.resolve(callCount === 1 ? page1 : page2);
      }
      if (url.includes("/dashboard/my-tasks")) {
        return Promise.resolve({ tasks: [], nextCursor: null });
      }
      if (url.includes("/activity")) {
        return Promise.resolve({ activities: [], nextCursor: null });
      }
      if (url.includes("/projects")) {
        return Promise.resolve({ projects: [{ id: "proj-1", name: "Test Project" }] });
      }
      return Promise.resolve({});
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Dashboard />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Load more tasks")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText("Load more tasks"));

    await waitFor(() => {
      // Page 2 data should now be merged in
      expect(screen.getByText("This Week")).toBeInTheDocument();
    });
  });
});

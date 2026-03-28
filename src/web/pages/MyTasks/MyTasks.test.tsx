import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MyTasks from "./MyTasks";

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

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1", name: "Alice", email: "alice@test.com", image: null },
    },
  }),
}));

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws-1", name: "Test Workspace", slug: "test" },
    members: [],
    teams: [],
    refetch: vi.fn(),
  }),
}));

vi.mock("@/web/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
}));

// Mock TaskDetailDialog so we can verify it opens without rendering the full
// dialog tree (which pulls in many heavy dependencies like dnd-kit, file upload, etc.)
vi.mock("@/web/components/ui/TaskDetailDialog", () => ({
  TaskDetailDialog: ({ taskId, open, onClose }: { taskId: string; open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="task-detail-dialog" data-task-id={taskId}>
        <button type="button" onClick={onClose}>Close dialog</button>
      </div>
    ) : null,
}));

import { api } from "@/web/lib/api/client";
const mockGet = api.get as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MyTaskRaw {
  id: string;
  title: string;
  completed: boolean;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  dueDate: string | null;
  projectId: string;
  projectName: string;
}

interface MyTasksResponse {
  tasks: MyTaskRaw[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeTask(overrides: Partial<MyTaskRaw> & { id: string }): MyTaskRaw {
  return {
    title: `Task ${overrides.id}`,
    completed: false,
    priority: "medium",
    dueDate: null,
    projectId: "proj-1",
    projectName: "Project Alpha",
    ...overrides,
  };
}

/**
 * Return a date string for "today" at noon local time to avoid timezone edge cases.
 */
function todayDateStr(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

/**
 * Return a date string for 2 days ago (overdue).
 */
function overdueDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

/**
 * Return a date string for 3 days from now (within the week, not today).
 */
function thisWeekDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

/**
 * Return a date string far in the future (not overdue, not today, not this week).
 */
function futureDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function setupMockGet(tasks: MyTaskRaw[], nextCursor: string | null = null) {
  mockGet.mockImplementation((url: string): unknown => {
    if (url.includes("/api/workspaces/") && url.includes("/dashboard/my-tasks")) {
      return Promise.resolve({ tasks, nextCursor } as MyTasksResponse);
    }
    return Promise.resolve({});
  });
}

/**
 * Locate a specific filter tab by matching its label text.
 *
 * Tabs use the Tabs compound component with role="tab", so we query by
 * role to avoid collisions with task title buttons in the table.
 */
function findFilterTab(label: string): HTMLElement {
  const tabs = screen.getAllByRole("tab");
  for (const tab of tabs) {
    const text = tab.textContent ?? "";
    if (text === label || text.startsWith(label)) {
      return tab;
    }
  }
  throw new Error(`Filter tab "${label}" not found among ${tabs.length} tabs`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Tests for the MyTasks page component which shows the current user's assigned
 * tasks with filter tabs, pagination, and task detail dialog integration.
 * Regressions here break the primary "my tasks" experience on the dashboard.
 */
describe("MyTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty task list
    setupMockGet([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Table structure and column headers
  // -------------------------------------------------------------------------

  describe("table structure", () => {
    it("renders table with correct column headers (Task, Project, Priority, Due Date)", async () => {
      const tasks = [makeTask({ id: "t1", title: "Setup CI" })];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Setup CI")).toBeInTheDocument();
      });

      // Verify column headers exist within the table
      const table = screen.getByRole("table");
      expect(within(table).getByText("Task")).toBeInTheDocument();
      expect(within(table).getByText("Project")).toBeInTheDocument();
      expect(within(table).getByText("Priority")).toBeInTheDocument();
      expect(within(table).getByText("Due Date")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Empty state
  // -------------------------------------------------------------------------

  describe("empty state", () => {
    it("shows empty state when no tasks exist", async () => {
      setupMockGet([]);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("No tasks assigned to you")).toBeInTheDocument();
      });
      expect(screen.getByText("Tasks assigned to you will appear here")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Task data rendering
  // -------------------------------------------------------------------------

  describe("task data rendering", () => {
    it("renders task name, project badge, priority badge, and formatted due date", async () => {
      const tasks = [
        makeTask({
          id: "t1",
          title: "Fix login bug",
          priority: "high",
          dueDate: todayDateStr(),
          projectName: "Auth Service",
        }),
        makeTask({
          id: "t2",
          title: "Write docs",
          priority: "low",
          dueDate: null,
          projectName: "Documentation",
        }),
      ];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      // Wait for task titles to appear
      await waitFor(() => {
        expect(screen.getByText("Fix login bug")).toBeInTheDocument();
        expect(screen.getByText("Write docs")).toBeInTheDocument();
      });

      // Project names rendered as badges
      expect(screen.getByText("Auth Service")).toBeInTheDocument();
      expect(screen.getByText("Documentation")).toBeInTheDocument();

      // Priority labels
      expect(screen.getByText("High")).toBeInTheDocument();
      expect(screen.getByText("Low")).toBeInTheDocument();

      // Due date for today — the word "Today" also appears in the filter tab,
      // so we scope to the table body to avoid collisions.
      const table = screen.getByRole("table");
      const tbody = within(table).getAllByRole("rowgroup")[1]; // thead=0, tbody=1
      expect(within(tbody).getByText("Today")).toBeInTheDocument();
    });

    it("renders different priority variants correctly", async () => {
      const tasks = [
        makeTask({ id: "t1", title: "Urgent fix", priority: "urgent" }),
        makeTask({ id: "t2", title: "Medium fix", priority: "medium" }),
        makeTask({ id: "t3", title: "No priority fix", priority: "none" }),
      ];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Urgent fix")).toBeInTheDocument();
      });

      expect(screen.getByText("Urgent")).toBeInTheDocument();
      expect(screen.getByText("Medium")).toBeInTheDocument();
      expect(screen.getByText("None")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Filter tabs
  // -------------------------------------------------------------------------

  describe("filter tabs", () => {
    it("renders all four filter tabs (All, Today, This Week, Overdue)", async () => {
      const tasks = [makeTask({ id: "t1", title: "Placeholder item" })];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      // Wait for data to load so tabs render with counts
      await waitFor(() => {
        expect(screen.getByText("Placeholder item")).toBeInTheDocument();
      });

      expect(findFilterTab("All")).toBeInTheDocument();
      expect(findFilterTab("Today")).toBeInTheDocument();
      expect(findFilterTab("This Week")).toBeInTheDocument();
      expect(findFilterTab("Overdue")).toBeInTheDocument();
    });

    it("defaults to 'This Week' tab and displays all tasks from API", async () => {
      const tasks = [
        makeTask({ id: "t1", title: "Task A", dueDate: todayDateStr() }),
        makeTask({ id: "t2", title: "Task B", dueDate: thisWeekDateStr() }),
      ];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Task A")).toBeInTheDocument();
        expect(screen.getByText("Task B")).toBeInTheDocument();
      });

      // Verify the API call includes period=week (the default tab)
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining("period=week"),
      );
    });

    it("clicking 'All' tab refetches without period param and shows all tasks", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t1", title: "Task Alpha", dueDate: futureDateStr() }),
      ];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Task Alpha")).toBeInTheDocument();
      });

      // Switch to "All" tab
      await user.click(findFilterTab("All"));

      // API should now be called without the period param
      await waitFor(() => {
        const calls = mockGet.mock.calls.map((c: unknown[]) => c[0] as string);
        const allTabCall = calls.find(
          (url: string) => url.includes("/dashboard/my-tasks") && !url.includes("period="),
        );
        expect(allTabCall).toBeDefined();
      });
    });

    it("clicking 'Today' tab filters tasks client-side to only today's tasks", async () => {
      const user = userEvent.setup();
      // Use task names that don't collide with tab labels
      const tasks = [
        makeTask({ id: "t1", title: "Due now item", dueDate: todayDateStr() }),
        makeTask({ id: "t2", title: "Far away item", dueDate: futureDateStr() }),
        makeTask({ id: "t3", title: "Unscheduled item", dueDate: null }),
      ];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      // Wait for initial data load
      await waitFor(() => {
        expect(screen.getByText("Due now item")).toBeInTheDocument();
      });

      // Switch to "Today" tab
      await user.click(findFilterTab("Today"));

      // Only today's task should be visible, others filtered out
      await waitFor(() => {
        expect(screen.getByText("Due now item")).toBeInTheDocument();
        expect(screen.queryByText("Far away item")).not.toBeInTheDocument();
        expect(screen.queryByText("Unscheduled item")).not.toBeInTheDocument();
      });
    });

    it("clicking 'Overdue' tab filters tasks client-side to only overdue tasks", async () => {
      const user = userEvent.setup();
      // Use task names that don't collide with "Overdue" tab label
      const tasks = [
        makeTask({ id: "t1", title: "Late item", dueDate: overdueDateStr() }),
        makeTask({ id: "t2", title: "Current item", dueDate: todayDateStr() }),
        makeTask({ id: "t3", title: "Upcoming item", dueDate: futureDateStr() }),
      ];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Late item")).toBeInTheDocument();
      });

      // Switch to "Overdue" tab
      await user.click(findFilterTab("Overdue"));

      await waitFor(() => {
        expect(screen.getByText("Late item")).toBeInTheDocument();
        expect(screen.queryByText("Current item")).not.toBeInTheDocument();
        expect(screen.queryByText("Upcoming item")).not.toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 5. Pagination / Load more
  // -------------------------------------------------------------------------

  describe("pagination", () => {
    it('shows "Load more tasks" button when hasNextPage is true', async () => {
      const tasks = [makeTask({ id: "t1", title: "First task" })];
      setupMockGet(tasks, "cursor-abc");

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("First task")).toBeInTheDocument();
      });

      expect(screen.getByText("Load more tasks")).toBeInTheDocument();
    });

    it('hides "Load more tasks" when no next page', async () => {
      const tasks = [makeTask({ id: "t1", title: "Single task" })];
      setupMockGet(tasks, null);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Single task")).toBeInTheDocument();
      });

      expect(screen.queryByText("Load more tasks")).not.toBeInTheDocument();
    });

    it("clicking 'Load more tasks' fetches the next page with cursor", async () => {
      const user = userEvent.setup();
      const page1Tasks = [makeTask({ id: "t1", title: "Page 1 task" })];
      const page2Tasks = [makeTask({ id: "t2", title: "Page 2 task" })];

      let callCount = 0;
      mockGet.mockImplementation((url: string): unknown => {
        if (url.includes("/dashboard/my-tasks")) {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ tasks: page1Tasks, nextCursor: "cursor-1" } as MyTasksResponse);
          }
          return Promise.resolve({ tasks: page2Tasks, nextCursor: null } as MyTasksResponse);
        }
        return Promise.resolve({});
      });

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Page 1 task")).toBeInTheDocument();
      });

      const loadMoreBtn = screen.getByText("Load more tasks");
      await user.click(loadMoreBtn);

      await waitFor(() => {
        expect(screen.getByText("Page 2 task")).toBeInTheDocument();
      });

      // Both pages should be visible
      expect(screen.getByText("Page 1 task")).toBeInTheDocument();

      // The second call should include the cursor
      const secondCall = mockGet.mock.calls.find(
        (c: unknown[]) => (c[0] as string).includes("cursor=cursor-1"),
      );
      expect(secondCall).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Task detail dialog
  // -------------------------------------------------------------------------

  describe("task detail dialog", () => {
    it("opens TaskDetailDialog when clicking a task name", async () => {
      const user = userEvent.setup();
      const tasks = [makeTask({ id: "t1", title: "Clickable task" })];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Clickable task")).toBeInTheDocument();
      });

      // Click the task title button
      await user.click(screen.getByText("Clickable task"));

      await waitFor(() => {
        const dialog = screen.getByTestId("task-detail-dialog");
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute("data-task-id", "t1");
      });
    });

    it("closes TaskDetailDialog when close button is clicked", async () => {
      const user = userEvent.setup();
      const tasks = [makeTask({ id: "t1", title: "Task to close" })];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Task to close")).toBeInTheDocument();
      });

      // Open dialog
      await user.click(screen.getByText("Task to close"));
      await waitFor(() => {
        expect(screen.getByTestId("task-detail-dialog")).toBeInTheDocument();
      });

      // Close dialog
      await user.click(screen.getByText("Close dialog"));

      await waitFor(() => {
        expect(screen.queryByTestId("task-detail-dialog")).not.toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 7. Task count summary
  // -------------------------------------------------------------------------

  describe("task count summary", () => {
    it("displays correct task count (plural) after loading", async () => {
      const tasks = [
        makeTask({ id: "t1", title: "Alpha" }),
        makeTask({ id: "t2", title: "Bravo" }),
        makeTask({ id: "t3", title: "Charlie" }),
      ];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("3 tasks")).toBeInTheDocument();
      });
    });

    it("displays singular 'task' when exactly 1 task", async () => {
      const tasks = [makeTask({ id: "t1", title: "Solo task" })];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("1 task")).toBeInTheDocument();
      });
    });

    it("updates task count when switching filter tabs", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t1", title: "Item due now", dueDate: todayDateStr() }),
        makeTask({ id: "t2", title: "Item far off", dueDate: futureDateStr() }),
        makeTask({ id: "t3", title: "Item past due", dueDate: overdueDateStr() }),
      ];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      // Default "This Week" tab shows all 3 from the API
      await waitFor(() => {
        expect(screen.getByText("3 tasks")).toBeInTheDocument();
      });

      // Switch to "Today" tab — only 1 task is due today
      await user.click(findFilterTab("Today"));

      await waitFor(() => {
        expect(screen.getByText("1 task")).toBeInTheDocument();
      });
    });

    it("displays tab badge counts correctly", async () => {
      const tasks = [
        makeTask({ id: "t1", title: "Item A", dueDate: todayDateStr() }),
        makeTask({ id: "t2", title: "Item B", dueDate: todayDateStr() }),
        makeTask({ id: "t3", title: "Item C", dueDate: overdueDateStr() }),
        makeTask({ id: "t4", title: "Item D", dueDate: futureDateStr() }),
      ];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Item A")).toBeInTheDocument();
      });

      // The "All" tab badge should show 4 (total)
      const allTab = findFilterTab("All");
      expect(within(allTab).getByText("4")).toBeInTheDocument();

      // The "Today" tab badge should show 2
      const todayTab = findFilterTab("Today");
      expect(within(todayTab).getByText("2")).toBeInTheDocument();

      // The "Overdue" tab badge should show 1
      const overdueTab = findFilterTab("Overdue");
      expect(within(overdueTab).getByText("1")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  describe("error state", () => {
    it("shows error message when API request fails", async () => {
      mockGet.mockImplementation((url: string): unknown => {
        if (url.includes("/dashboard/my-tasks")) {
          return Promise.reject(new Error("Network error"));
        }
        return Promise.resolve({});
      });

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Failed to load tasks.")).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Breadcrumbs
  // -------------------------------------------------------------------------

  describe("breadcrumbs", () => {
    it("renders workspace name and 'My Tasks' breadcrumbs", async () => {
      setupMockGet([]);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      // Breadcrumb navigation has aria-label="Breadcrumb"
      const nav = await waitFor(() => screen.getByLabelText("Breadcrumb"));
      expect(within(nav).getByText("Test Workspace")).toBeInTheDocument();
      expect(within(nav).getByText("My Tasks")).toBeInTheDocument();
    });
  });
});

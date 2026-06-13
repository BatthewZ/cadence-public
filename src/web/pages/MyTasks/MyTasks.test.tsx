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

const mockToast = vi.fn();
vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/web/hooks/use-reduced-motion", () => ({
  usePrefersReducedMotion: () => true,
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
const mockPost = api.post as ReturnType<typeof vi.fn>;

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

/**
 * `initialEntries` lets URL-driven states be tested (the filter bar persists
 * every dimension in search params, so "render the page at this URL" IS the
 * page's restore-a-shared-link path). Defaults to ["/"] — identical to
 * MemoryRouter's own default — so pre-existing tests are unaffected.
 */
function createWrapper(initialEntries: string[] = ["/"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
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

/**
 * Supporting datasets for the workspace-scoped lookup endpoints the filter
 * bar reads (label/project/task-group options). Tasks come first in the URL
 * dispatch below because the my-tasks URL also contains "/workspaces/".
 */
interface MockLookupData {
  labels?: { name: string; color: string }[];
  projects?: { id: string; name: string; status: string }[];
  taskGroups?: {
    id: string;
    name: string;
    color: string | null;
    isCompletionGroup: boolean;
    position: string;
    projectId: string;
    projectName: string;
  }[];
}

function setupMockGet(
  tasks: MyTaskRaw[],
  nextCursor: string | null = null,
  lookups: MockLookupData = {},
) {
  mockGet.mockImplementation((url: string): unknown => {
    if (url.includes("/api/workspaces/") && url.includes("/dashboard/my-tasks")) {
      return Promise.resolve({ tasks, nextCursor } as MyTasksResponse);
    }
    if (url.includes("/labels")) {
      return Promise.resolve({ labels: lookups.labels ?? [] });
    }
    if (url.includes("/task-groups")) {
      return Promise.resolve({ taskGroups: lookups.taskGroups ?? [] });
    }
    if (url.includes("/projects")) {
      return Promise.resolve({ projects: lookups.projects ?? [] });
    }
    return Promise.resolve({});
  });
}

/**
 * Search params of every my-tasks request, in call order. Filter tests
 * assert against the LAST entry: each filter change produces a new query key
 * and therefore a new request, so the latest request is the page's current
 * understanding of the active filters — exactly what a regression in the
 * URL↔API mapping would corrupt.
 */
function myTasksCallParams(): URLSearchParams[] {
  return mockGet.mock.calls
    .map((c: unknown[]) => c[0] as string)
    .filter((url) => url.includes("/dashboard/my-tasks"))
    .map((url) => new URLSearchParams(url.split("?")[1] ?? ""));
}

function lastMyTasksParams(): URLSearchParams {
  const all = myTasksCallParams();
  if (all.length === 0) throw new Error("No my-tasks request has been made");
  return all[all.length - 1];
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
  // Inline completion checkbox
  // -------------------------------------------------------------------------

  describe("inline completion checkbox", () => {
    it("renders a checkbox in each task row", async () => {
      const tasks = [
        makeTask({ id: "t1", title: "Task One" }),
        makeTask({ id: "t2", title: "Task Two" }),
      ];
      setupMockGet(tasks);

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Task One")).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(2);
      expect(checkboxes[0]).toHaveAttribute("aria-label", "Complete task: Task One");
      expect(checkboxes[1]).toHaveAttribute("aria-label", "Complete task: Task Two");
    });

    it("calls POST /api/tasks/:id/complete when checkbox is clicked", async () => {
      const user = userEvent.setup();
      const tasks = [makeTask({ id: "t1", title: "Complete me" })];
      setupMockGet(tasks);
      mockPost.mockResolvedValue({ task: { id: "t1", completed: true } });

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Complete me")).toBeInTheDocument();
      });

      const checkbox = screen.getByRole("checkbox");
      await user.click(checkbox);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith("/api/tasks/t1/complete", {});
      });
    });

    it("removes task from list after successful completion", async () => {
      const user = userEvent.setup();
      const task1 = makeTask({ id: "t1", title: "Will complete" });
      const task2 = makeTask({ id: "t2", title: "Will stay" });
      setupMockGet([task1, task2]);
      mockPost.mockImplementation((): unknown => {
        // After completion, subsequent fetches should exclude the completed task
        setupMockGet([task2]);
        return Promise.resolve({ task: { id: "t1", completed: true } });
      });

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Will complete")).toBeInTheDocument();
        expect(screen.getByText("Will stay")).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole("checkbox");
      await user.click(checkboxes[0]);

      await waitFor(() => {
        expect(screen.queryByText("Will complete")).not.toBeInTheDocument();
      });
      expect(screen.getByText("Will stay")).toBeInTheDocument();
    });

    it("shows error toast and keeps task on API failure", async () => {
      const user = userEvent.setup();
      const tasks = [makeTask({ id: "t1", title: "Fail to complete" })];
      setupMockGet(tasks);
      mockPost.mockRejectedValue(new Error("Network error"));

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Fail to complete")).toBeInTheDocument();
      });

      const checkbox = screen.getByRole("checkbox");
      await user.click(checkbox);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith("Failed to complete task", { variant: "error" });
      });

      // Task should still be visible after rollback
      expect(screen.getByText("Fail to complete")).toBeInTheDocument();
    });

    it("does not open TaskDetailDialog when checkbox is clicked", async () => {
      const user = userEvent.setup();
      const tasks = [makeTask({ id: "t1", title: "Checkbox only" })];
      setupMockGet(tasks);
      mockPost.mockResolvedValue({ task: { id: "t1", completed: true } });

      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <MyTasks />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText("Checkbox only")).toBeInTheDocument();
      });

      const checkbox = screen.getByRole("checkbox");
      await user.click(checkbox);

      // Dialog should NOT open
      expect(screen.queryByTestId("task-detail-dialog")).not.toBeInTheDocument();
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

  // -------------------------------------------------------------------------
  // Filter bar: priority / due date / label dimensions
  // -------------------------------------------------------------------------

  /**
   * These tests pin the URL-param ↔ API-param contract of the new filter
   * dimensions (web `label` → API `labelNames`; the rest map 1:1) and the
   * batched-single-update behavior of multi-param writes. Two bugs in this
   * filtering bundle were found at QA gates because react-router's functional
   * `setSearchParams` updater closes over render-time params — back-to-back
   * per-key calls in one handler silently lose all but the last write. The
   * quick-pick, range-chip-removal, and clear-all tests below MUST fail if
   * anyone reverts the batched single-call writes to per-key calls.
   */
  describe("filter bar (priority / due date / label)", () => {
    const LABELS = [
      { name: "Bug", color: "#ef4444" },
      { name: "Frontend", color: "#3b82f6" },
    ];
    const PROJECTS = [{ id: "proj-1", name: "Project Alpha", status: "active" }];
    const TASK_GROUPS = [
      {
        id: "g1",
        name: "To Do",
        color: null,
        isCompletionGroup: false,
        position: "a0",
        projectId: "proj-1",
        projectName: "Project Alpha",
      },
    ];

    // Task titles deliberately avoid the filter trigger names ("Priority",
    // "Due date", "Label"): task titles render as <button>s, so a title
    // starting with a trigger name would collide with getByRole queries.
    const ROW = makeTask({ id: "t1", title: "Row item" });

    describe("URL → API mapping", () => {
      it("maps every filter URL param onto the API request (label → labelNames)", async () => {
        setupMockGet([ROW], null, { labels: LABELS });

        const Wrapper = createWrapper([
          "/?priority=urgent,high&dueDateFrom=2026-06-01&dueDateTo=2026-06-30&noDueDate=true&label=Bug,Frontend&noLabel=true",
        ]);
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );

        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        const params = lastMyTasksParams();
        expect(params.get("priority")).toBe("urgent,high");
        expect(params.get("dueDateFrom")).toBe("2026-06-01");
        expect(params.get("dueDateTo")).toBe("2026-06-30");
        expect(params.get("noDueDate")).toBe("true");
        expect(params.get("labelNames")).toBe("Bug,Frontend");
        expect(params.get("noLabel")).toBe("true");
        // The web-side param name must not leak through to the API.
        expect(params.get("label")).toBeNull();
      });

      it("degrades invalid URL values to 'no filter' instead of a 400ing request", async () => {
        setupMockGet([ROW]);

        const Wrapper = createWrapper([
          // banana is not a priority; 2026-02-30 is date-shaped but not a
          // real calendar day; bare text is not a date at all. The server
          // rejects all three with a 400, so the client must drop them.
          "/?priority=banana,urgent&dueDateFrom=2026-02-30&dueDateTo=banana",
        ]);
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );

        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        const params = lastMyTasksParams();
        expect(params.get("priority")).toBe("urgent");
        expect(params.get("dueDateFrom")).toBeNull();
        expect(params.get("dueDateTo")).toBeNull();
      });

      it("treats label=none as a literal label NAME, never as the absence sentinel", async () => {
        setupMockGet([ROW], null, { labels: [{ name: "none", color: "#888888" }] });

        const Wrapper = createWrapper(["/?label=none"]);
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );

        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        // "none" is a legal user-entered label name; absence-of-label only
        // ever travels via the dedicated noLabel param.
        const params = lastMyTasksParams();
        expect(params.get("labelNames")).toBe("none");
        expect(params.get("noLabel")).toBeNull();
      });
    });

    describe("filter selection sends the exact query string", () => {
      it("selecting priorities sends them as a CSV priority param", async () => {
        const user = userEvent.setup();
        setupMockGet([ROW]);

        const Wrapper = createWrapper();
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );
        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        await user.click(screen.getByRole("button", { name: /^Priority/ }));
        await screen.findByText("Filter by priority");
        await user.click(screen.getByRole("checkbox", { name: "Urgent" }));

        await waitFor(() => {
          expect(lastMyTasksParams().get("priority")).toBe("urgent");
        });

        await user.click(screen.getByRole("checkbox", { name: "High" }));

        await waitFor(() => {
          expect(lastMyTasksParams().get("priority")).toBe("urgent,high");
        });
      });

      it("a due-date quick-pick sets dueDateFrom AND dueDateTo in one request (batched multi-key patch)", async () => {
        const user = userEvent.setup();
        setupMockGet([ROW]);

        const Wrapper = createWrapper();
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );
        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        await user.click(screen.getByRole("button", { name: "Due date" }));
        await screen.findByText("Filter by due date");
        await user.click(screen.getByRole("button", { name: "This week" }));

        // Both bounds must land in the SAME request: the quick-pick emits one
        // from+to patch, and a per-key setSearchParams regression would drop
        // `from` (last write wins over the stale closure).
        await waitFor(() => {
          const params = lastMyTasksParams();
          expect(params.get("dueDateFrom")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(params.get("dueDateTo")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
      });

      it("toggling 'No due date' sends noDueDate=true", async () => {
        const user = userEvent.setup();
        setupMockGet([ROW]);

        const Wrapper = createWrapper();
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );
        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        await user.click(screen.getByRole("button", { name: "Due date" }));
        await screen.findByText("Filter by due date");
        await user.click(screen.getByRole("checkbox", { name: "No due date" }));

        await waitFor(() => {
          expect(lastMyTasksParams().get("noDueDate")).toBe("true");
        });
      });

      it("selecting a label plus 'No label' sends labelNames CSV and noLabel=true", async () => {
        const user = userEvent.setup();
        setupMockGet([ROW], null, { labels: LABELS });

        const Wrapper = createWrapper();
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );
        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        await user.click(screen.getByRole("button", { name: /^Label/ }));
        await screen.findByText("Filter by label");
        await user.click(await screen.findByRole("checkbox", { name: "Bug" }));

        await waitFor(() => {
          const params = lastMyTasksParams();
          expect(params.get("labelNames")).toBe("Bug");
          expect(params.get("noLabel")).toBeNull();
        });

        // The pinned option adds the FILTER_NONE sentinel to the popover's
        // selection; the page must split it into noLabel=true and keep the
        // sentinel OUT of the names param ("none" is a legal label name).
        await user.click(screen.getByRole("checkbox", { name: "No label" }));

        await waitFor(() => {
          const params = lastMyTasksParams();
          expect(params.get("labelNames")).toBe("Bug");
          expect(params.get("noLabel")).toBe("true");
        });
      });
    });

    describe("chips", () => {
      it("renders chips for every active dimension", async () => {
        setupMockGet([ROW], null, { labels: LABELS });

        const Wrapper = createWrapper([
          "/?priority=urgent&dueDateFrom=2026-06-01&dueDateTo=2026-06-30&noDueDate=true&label=Bug&noLabel=true",
        ]);
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );
        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        expect(screen.getByText("Urgent")).toBeInTheDocument();
        expect(screen.getByText("2026-06-01 — 2026-06-30")).toBeInTheDocument();
        expect(screen.getByText("No due date")).toBeInTheDocument();
        expect(screen.getByText("No label")).toBeInTheDocument();
        expect(screen.getByText("Bug")).toBeInTheDocument();
      });

      it("removing a priority chip drops only that priority", async () => {
        const user = userEvent.setup();
        setupMockGet([ROW]);

        const Wrapper = createWrapper(["/?priority=urgent,high"]);
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );
        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        await user.click(
          screen.getByRole("button", { name: "Remove priority filter urgent" }),
        );

        await waitFor(() => {
          expect(lastMyTasksParams().get("priority")).toBe("high");
        });
        expect(screen.queryByText("Urgent")).not.toBeInTheDocument();
        expect(screen.getByText("High")).toBeInTheDocument();
      });

      it("removing the date-range chip clears BOTH bounds in one update and keeps noDueDate", async () => {
        const user = userEvent.setup();
        setupMockGet([ROW]);

        const Wrapper = createWrapper([
          "/?dueDateFrom=2026-06-01&dueDateTo=2026-06-30&noDueDate=true",
        ]);
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );
        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        await user.click(
          screen.getByRole("button", { name: "Remove due date filter" }),
        );

        // Regression: a per-key remover would resurrect one bound (stale
        // closure, last write wins) — both must vanish together, while the
        // independent noDueDate absence sub-filter must survive.
        await waitFor(() => {
          const params = lastMyTasksParams();
          expect(params.get("dueDateFrom")).toBeNull();
          expect(params.get("dueDateTo")).toBeNull();
          expect(params.get("noDueDate")).toBe("true");
        });
        expect(screen.getByText("No due date")).toBeInTheDocument();
      });

      it("removing the 'No due date' chip keeps the date range", async () => {
        const user = userEvent.setup();
        setupMockGet([ROW]);

        const Wrapper = createWrapper([
          "/?dueDateFrom=2026-06-01&dueDateTo=2026-06-30&noDueDate=true",
        ]);
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );
        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        await user.click(
          screen.getByRole("button", { name: "Remove no due date filter" }),
        );

        await waitFor(() => {
          const params = lastMyTasksParams();
          expect(params.get("noDueDate")).toBeNull();
          expect(params.get("dueDateFrom")).toBe("2026-06-01");
          expect(params.get("dueDateTo")).toBe("2026-06-30");
        });
      });

      it("removing the 'No label' chip keeps selected label names", async () => {
        const user = userEvent.setup();
        setupMockGet([ROW], null, { labels: LABELS });

        const Wrapper = createWrapper(["/?label=Bug&noLabel=true"]);
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );
        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        await user.click(
          screen.getByRole("button", { name: "Remove no label filter" }),
        );

        // Absence OR-composes with names within the dimension: dropping the
        // absence flag must not take the real label selection with it.
        await waitFor(() => {
          const params = lastMyTasksParams();
          expect(params.get("noLabel")).toBeNull();
          expect(params.get("labelNames")).toBe("Bug");
        });
        expect(screen.getByText("Bug")).toBeInTheDocument();
        expect(screen.queryByText("No label")).not.toBeInTheDocument();
      });

      it("removing a label chip keeps the noLabel filter", async () => {
        const user = userEvent.setup();
        setupMockGet([ROW], null, { labels: LABELS });

        const Wrapper = createWrapper(["/?label=Bug&noLabel=true"]);
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );
        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        await user.click(
          screen.getByRole("button", { name: "Remove label filter Bug" }),
        );

        await waitFor(() => {
          const params = lastMyTasksParams();
          expect(params.get("labelNames")).toBeNull();
          expect(params.get("noLabel")).toBe("true");
        });
        expect(screen.getByText("No label")).toBeInTheDocument();
      });
    });

    describe("clear all", () => {
      it("'Clear filters' removes EVERY filter in one batched update (gate-found regression)", async () => {
        const user = userEvent.setup();
        setupMockGet([makeTask({ id: "t1", title: "Row item", projectId: "proj-1" })], null, {
          labels: LABELS,
          projects: PROJECTS,
          taskGroups: TASK_GROUPS,
        });

        const Wrapper = createWrapper([
          "/?project=proj-1&taskGroup=g1&priority=urgent&dueDateFrom=2026-06-01&dueDateTo=2026-06-30&noDueDate=true&label=Bug&noLabel=true",
        ]);
        render(
          <Wrapper>
            <MyTasks />
          </Wrapper>,
        );
        await waitFor(() => {
          expect(screen.getByText("Row item")).toBeInTheDocument();
        });

        // Sanity: the initial request carried every dimension, so the
        // assertions below prove clearing (not that filters never applied).
        const before = lastMyTasksParams();
        expect(before.get("projectIds")).toBe("proj-1");
        expect(before.get("taskGroupIds")).toBe("g1");
        expect(before.get("priority")).toBe("urgent");
        expect(before.get("noLabel")).toBe("true");

        await user.click(screen.getByRole("button", { name: "Clear filters" }));

        // Regression pin: clearAllFilters must delete ALL params in ONE
        // setSearchParams call. If someone reverts to calling the per-key
        // setters back-to-back, react-router's stale-closure semantics make
        // the last write win and earlier deletions resurrect — the request
        // below would then still carry projectIds/priority/etc. and this
        // waitFor would time out.
        await waitFor(() => {
          const params = lastMyTasksParams();
          for (const param of [
            "projectIds",
            "taskGroupIds",
            "priority",
            "dueDateFrom",
            "dueDateTo",
            "noDueDate",
            "labelNames",
            "noLabel",
          ]) {
            expect(params.get(param)).toBeNull();
          }
        });

        // The bar reflects the cleared state: no chips, no Clear button.
        expect(screen.queryByText("Clear filters")).not.toBeInTheDocument();
        expect(screen.queryByText("No label")).not.toBeInTheDocument();
        expect(screen.queryByText("Urgent")).not.toBeInTheDocument();
      });
    });
  });
});

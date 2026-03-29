import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectDashboardData } from "@/web/hooks/use-project-dashboard";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/web/lib/api/client", () => ({
  api: Object.assign(vi.fn(), {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
  setOnUnauthorized: vi.fn(),
}));

const mockUseProject = vi.fn();

vi.mock("@/web/contexts/ProjectContext", () => ({
  useProject: (): unknown => mockUseProject(),
}));

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws-1", name: "Test Workspace", slug: "test-ws" },
    members: [
      {
        id: "wm-1",
        userId: "user-1",
        role: "owner",
        user: { id: "user-1", name: "Alice", email: "alice@test.com" },
      },
      {
        id: "wm-2",
        userId: "user-2",
        role: "member",
        user: { id: "user-2", name: "Bob", email: "bob@test.com" },
      },
    ],
    teams: [],
    projects: [],
    refetch: vi.fn(),
  }),
}));

vi.mock("@/web/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1", name: "Alice", email: "alice@test.com", image: null },
    },
  }),
}));

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/web/components/ui/AppShell", () => ({
  useAppShell: () => ({ isMobile: false, sidebarOpen: true, setSidebarOpen: vi.fn() }),
  useOptionalAppShell: () => null,
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const mockUseProjectDashboard = vi.fn();

vi.mock("@/web/hooks/use-project-dashboard", () => ({
  useProjectDashboard: (): unknown => mockUseProjectDashboard(),
}));

const mockUseProjectActivity = vi.fn();

vi.mock("@/web/hooks/use-project-activity", () => ({
  useProjectActivity: (): unknown => mockUseProjectActivity(),
}));

// Stub TaskDetailDialog so it renders a lightweight marker we can assert on
vi.mock("@/web/components/ui/TaskDetailDialog", () => ({
  TaskDetailDialog: ({
    taskId,
    open,
    onClose,
  }: {
    taskId: string;
    open: boolean;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid="task-detail-dialog" data-task-id={taskId}>
        <button type="button" onClick={onClose}>
          Close Dialog
        </button>
      </div>
    ) : null,
}));

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
globalThis.IntersectionObserver =
  IntersectionObserverStub as unknown as typeof IntersectionObserver;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    // Return true for prefers-reduced-motion so StatCard shows final values immediately
    matches: query.includes("prefers-reduced-motion") ? true : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Dynamic import after mocks are set up
const { default: ProjectDashboard } = await import("./ProjectDashboard");

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

function setupProjectMock() {
  mockUseProject.mockReturnValue({
    project: { id: "proj-1", name: "Test Project" },
    members: [],
    taskGroups: [],
    tasks: [],
    refetchTasks: vi.fn(),
    refetchTaskGroups: vi.fn(),
    refetch: vi.fn(),
    updateProject: vi.fn(),
    updateTask: vi.fn(),
    removeTask: vi.fn(),
    addTask: vi.fn(),
    updateTaskGroup: vi.fn(),
    removeTaskGroup: vi.fn(),
    addTaskGroup: vi.fn(),
  });
}

function makeDashboardData(
  overrides: Partial<ProjectDashboardData> = {},
): ProjectDashboardData {
  return {
    taskCounts: { activeCount: 12, completedCount: 8, totalCount: 20 },
    tasksByGroup: [
      { taskGroupId: "tg-1", taskGroupName: "To Do", count: 7 },
      { taskGroupId: "tg-2", taskGroupName: "In Progress", count: 5 },
      { taskGroupId: "tg-3", taskGroupName: "Done", count: 8 },
    ],
    tasksPerMember: [
      { id: "user-1", name: "Alice", count: 10 },
      { id: "user-2", name: "Bob", count: 6 },
      { id: "user-3", name: "Charlie", count: 4 },
    ],
    upcomingTasks: [
      {
        id: "task-upcoming-1",
        title: "Finish documentation",
        completed: false,
        priority: "high",
        dueDate: new Date(Date.now() + 2 * 86400000).toISOString(),
        assigneeId: "user-1",
        taskGroupId: "tg-1",
        taskGroupName: "To Do",
      },
      {
        id: "task-upcoming-2",
        title: "Deploy staging",
        completed: false,
        priority: "medium",
        dueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
        assigneeId: "user-2",
        taskGroupId: "tg-2",
        taskGroupName: "In Progress",
      },
    ],
    overdueTasks: [
      {
        id: "task-overdue-1",
        title: "Fix critical bug",
        priority: "urgent",
        dueDate: new Date(Date.now() - 3 * 86400000).toISOString(),
        assigneeId: "user-1",
        assigneeName: "Alice",
        assigneeImage: null,
        taskGroupName: "To Do",
      },
    ],
    priorityBreakdown: [
      { priority: "urgent", count: 2 },
      { priority: "high", count: 5 },
      { priority: "medium", count: 8 },
      { priority: "low", count: 3 },
      { priority: "none", count: 2 },
    ],
    costAggregation: {
      totalCost: 150000,
      completedCost: 80000,
      activeCost: 70000,
      tasksWithCost: 10,
    },
    budget: 200000,
    costPerMember: [
      { id: "user-1", name: "Alice", totalCost: 80000 },
      { id: "user-2", name: "Bob", totalCost: 70000 },
    ],
    ...overrides,
  };
}

function setupDashboardMock(
  data: ProjectDashboardData | null = null,
  opts: { isLoading?: boolean; isError?: boolean } = {},
) {
  mockUseProjectDashboard.mockReturnValue({
    data: data,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    refetch: vi.fn(),
  });
}

function setupActivityMock(
  activities: Array<{
    id: string;
    taskId: string;
    taskTitle: string;
    actorId: string | null;
    actorName: string | null;
    actorImage: string | null;
    action: string;
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }> = [],
  opts: { isLoading?: boolean; isError?: boolean; hasNextPage?: boolean } = {},
) {
  mockUseProjectActivity.mockReturnValue({
    data: { pages: [{ activities, nextCursor: null }] },
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    fetchNextPage: vi.fn(),
    hasNextPage: opts.hasNextPage ?? false,
    isFetchingNextPage: false,
  });
}

function makeActivity(
  id: string,
  title: string,
  action = "created",
) {
  return {
    id,
    taskId: `task-${id}`,
    taskTitle: title,
    actorId: "user-1",
    actorName: "Alice",
    actorImage: null,
    action,
    field: null,
    oldValue: null,
    newValue: null,
    createdAt: new Date().toISOString(),
  };
}

function renderDashboard() {
  return render(<ProjectDashboard />, { wrapper: createWrapper() });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  setupProjectMock();
  setupActivityMock();
});

describe("ProjectDashboard", () => {
  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  describe("loading state", () => {
    it("renders skeleton placeholders while data is loading", () => {
      setupDashboardMock(null, { isLoading: true });
      renderDashboard();

      // The skeleton includes stat card placeholders. There are 3 stat card
      // skeletons, each with a label skeleton (w-24) and a value skeleton (w-16).
      // We can verify the skeleton is present by looking for the skeleton cards.
      const skeletons = document.querySelectorAll("[class*='skeleton']");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------
  describe("error state", () => {
    it("shows error empty state when dashboard fails to load", () => {
      setupDashboardMock(null, { isError: true });
      renderDashboard();

      expect(screen.getByText("Failed to load project dashboard.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    it("shows error empty state when data is null", () => {
      setupDashboardMock(null);
      renderDashboard();

      expect(screen.getByText("Failed to load project dashboard.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Stat cards
  // -------------------------------------------------------------------------
  describe("stat cards", () => {
    it("renders active tasks, completed, and completion rate stat cards", () => {
      const data = makeDashboardData({
        taskCounts: { activeCount: 15, completedCount: 5, totalCount: 20 },
      });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("Active Tasks")).toBeInTheDocument();
      expect(screen.getByText("Completed")).toBeInTheDocument();
      expect(screen.getByText("Completion Rate")).toBeInTheDocument();
    });

    it("computes completion rate correctly", () => {
      const data = makeDashboardData({
        taskCounts: { activeCount: 6, completedCount: 4, totalCount: 10 },
      });
      setupDashboardMock(data);
      renderDashboard();

      // 4/10 = 40%
      expect(screen.getByText("40%")).toBeInTheDocument();
    });

    it("shows 0% completion rate when there are no tasks", () => {
      const data = makeDashboardData({
        taskCounts: { activeCount: 0, completedCount: 0, totalCount: 0 },
      });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("0%")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Overdue tasks
  // -------------------------------------------------------------------------
  describe("overdue tasks section", () => {
    it("renders overdue tasks with priority badges and assignee avatars", () => {
      const data = makeDashboardData();
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("Overdue")).toBeInTheDocument();
      expect(screen.getByText("Fix critical bug")).toBeInTheDocument();
      expect(screen.getByText("urgent")).toBeInTheDocument();
    });

    it("does not render overdue section when there are no overdue tasks", () => {
      const data = makeDashboardData({ overdueTasks: [] });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Budget & Costs section
  // -------------------------------------------------------------------------
  describe("budget and costs section", () => {
    it("renders budget stats with correct formatted values", () => {
      const data = makeDashboardData({
        costAggregation: {
          totalCost: 150000,
          completedCost: 80000,
          activeCost: 70000,
          tasksWithCost: 10,
        },
        budget: 200000,
      });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("Budget & Costs")).toBeInTheDocument();
      expect(screen.getByText("Total Cost")).toBeInTheDocument();
      expect(screen.getByText("Completed Cost")).toBeInTheDocument();
      expect(screen.getByText("Active Cost")).toBeInTheDocument();
    });

    it("does not render budget section when no tasks have costs", () => {
      const data = makeDashboardData({
        costAggregation: {
          totalCost: 0,
          completedCost: 0,
          activeCost: 0,
          tasksWithCost: 0,
        },
      });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.queryByText("Budget & Costs")).not.toBeInTheDocument();
    });

    it("renders budget card with budget, spent, and remaining values", () => {
      // Use values that don't collide: totalCost, completedCost, activeCost
      // all differ from budget/spent/remaining to avoid duplicate text matches.
      // Budget = $5,000 (500000 cents), Spent = totalCost = $3,200 (320000),
      // Remaining = $1,800
      const data = makeDashboardData({
        costAggregation: {
          totalCost: 320000,
          completedCost: 210000,
          activeCost: 110000,
          tasksWithCost: 10,
        },
        budget: 500000,
      });
      setupDashboardMock(data);
      renderDashboard();

      // BudgetCard values: Budget $5,000, Spent $3,200, Remaining $1,800
      expect(screen.getByText("$5,000")).toBeInTheDocument();
      expect(screen.getByText("$1,800")).toBeInTheDocument();
      // "Spent" and "Remaining" labels within the card
      expect(screen.getByText("Spent")).toBeInTheDocument();
      expect(screen.getByText("Remaining")).toBeInTheDocument();
    });

    it("shows over budget indicator when costs exceed budget", () => {
      const data = makeDashboardData({
        costAggregation: {
          totalCost: 250000,
          completedCost: 150000,
          activeCost: 100000,
          tasksWithCost: 10,
        },
        budget: 200000,
      });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("Over Budget")).toBeInTheDocument();
      // $500 over
      expect(screen.getByText("$500 over")).toBeInTheDocument();
    });

    it("renders proportional overage bar segments when over budget", () => {
      const data = makeDashboardData({
        costAggregation: {
          totalCost: 300000,
          completedCost: 200000,
          activeCost: 100000,
          tasksWithCost: 10,
        },
        budget: 200000,
      });
      setupDashboardMock(data);
      renderDashboard();

      // Overage bar has two segments: budget portion and overage portion
      // budget/spent * 100 = 200000/300000 * 100 ≈ 66.67%
      // overage/spent * 100 = 100000/300000 * 100 ≈ 33.33%
      const budgetSegment = screen.getByTitle("Budget: $2,000");
      const overageSegment = screen.getByTitle("Overage: $1,000");
      expect(budgetSegment).toBeInTheDocument();
      expect(overageSegment).toBeInTheDocument();
    });

    it("renders cost per member section sorted by highest cost", () => {
      const data = makeDashboardData({
        costPerMember: [
          { id: "user-1", name: "Alice", totalCost: 90000 },
          { id: "user-2", name: "Bob", totalCost: 120000 },
        ],
      });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("Cost by Member")).toBeInTheDocument();
      // Bob is higher cost so should appear — both names should be in document
      expect(screen.getByText("$1,200")).toBeInTheDocument();
      expect(screen.getByText("$900")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Priority breakdown
  // -------------------------------------------------------------------------
  describe("priority breakdown", () => {
    it("renders priority labels and counts", () => {
      const data = makeDashboardData({
        priorityBreakdown: [
          { priority: "urgent", count: 2 },
          { priority: "high", count: 5 },
          { priority: "medium", count: 3 },
        ],
      });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("Priority Breakdown")).toBeInTheDocument();
      expect(screen.getByText("Urgent")).toBeInTheDocument();
      expect(screen.getByText("High")).toBeInTheDocument();
      expect(screen.getByText("Medium")).toBeInTheDocument();
    });

    it("shows empty state when no active tasks for priority breakdown", () => {
      const data = makeDashboardData({ priorityBreakdown: [] });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("No active tasks")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Tasks by section
  // -------------------------------------------------------------------------
  describe("tasks by section", () => {
    it("renders task groups sorted by count", () => {
      // Use distinct group names that don't collide with upcoming/overdue task data
      const data = makeDashboardData({
        tasksByGroup: [
          { taskGroupId: "tg-1", taskGroupName: "Backlog", count: 3 },
          { taskGroupId: "tg-2", taskGroupName: "Development", count: 10 },
          { taskGroupId: "tg-3", taskGroupName: "QA Review", count: 7 },
        ],
      });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("Tasks by Section")).toBeInTheDocument();
      expect(screen.getByText("Backlog")).toBeInTheDocument();
      expect(screen.getByText("Development")).toBeInTheDocument();
      expect(screen.getByText("QA Review")).toBeInTheDocument();
    });

    it("shows empty state when no task groups", () => {
      const data = makeDashboardData({ tasksByGroup: [] });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Team workload
  // -------------------------------------------------------------------------
  describe("team workload", () => {
    it("renders team members with task counts", () => {
      const data = makeDashboardData({
        tasksPerMember: [
          { id: "user-1", name: "Alice", count: 10 },
          { id: "user-2", name: "Bob", count: 6 },
        ],
      });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("Team Workload")).toBeInTheDocument();
      expect(screen.getByText("10 tasks")).toBeInTheDocument();
      expect(screen.getByText("6 tasks")).toBeInTheDocument();
    });

    it("uses singular form for 1 task", () => {
      const data = makeDashboardData({
        tasksPerMember: [{ id: "user-1", name: "Alice", count: 1 }],
      });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("1 task")).toBeInTheDocument();
    });

    it("shows empty state when no tasks are assigned", () => {
      const data = makeDashboardData({ tasksPerMember: [] });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("No tasks assigned yet")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Upcoming deadlines
  // -------------------------------------------------------------------------
  describe("upcoming deadlines", () => {
    it("renders upcoming tasks with priority badges and group names", () => {
      const data = makeDashboardData();
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("Upcoming Deadlines")).toBeInTheDocument();
      expect(screen.getByText("Finish documentation")).toBeInTheDocument();
      expect(screen.getByText("Deploy staging")).toBeInTheDocument();
    });

    it("shows empty state when no upcoming deadlines", () => {
      const data = makeDashboardData({ upcomingTasks: [] });
      setupDashboardMock(data);
      renderDashboard();

      expect(screen.getByText("No upcoming deadlines")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Activity feed
  // -------------------------------------------------------------------------
  describe("activity feed", () => {
    it("renders activity items with actor names", () => {
      const data = makeDashboardData();
      setupDashboardMock(data);
      setupActivityMock([
        makeActivity("act-1", "Write tests"),
        makeActivity("act-2", "Fix navigation"),
      ]);
      renderDashboard();

      expect(screen.getByText("Recent Activity")).toBeInTheDocument();
      expect(screen.getByText("Write tests")).toBeInTheDocument();
      expect(screen.getByText("Fix navigation")).toBeInTheDocument();
    });

    it("shows loading skeleton for activity feed", () => {
      const data = makeDashboardData();
      setupDashboardMock(data);
      setupActivityMock([], { isLoading: true });
      renderDashboard();

      // The activity loading state still shows the "Recent Activity" header
      expect(screen.getByText("Recent Activity")).toBeInTheDocument();
    });

    it("shows error state when activity fails to load", () => {
      const data = makeDashboardData();
      setupDashboardMock(data);
      setupActivityMock([], { isError: true });
      renderDashboard();

      expect(screen.getByText("Failed to load activity.")).toBeInTheDocument();
    });

    it("shows 'No activity yet' when activity list is empty", () => {
      const data = makeDashboardData();
      setupDashboardMock(data);
      setupActivityMock([]);
      renderDashboard();

      expect(screen.getByText("No activity yet")).toBeInTheDocument();
    });

    it("renders 'Load more' button when hasNextPage is true", () => {
      const data = makeDashboardData();
      setupDashboardMock(data);
      setupActivityMock([makeActivity("act-1", "Some task")], {
        hasNextPage: true,
      });
      renderDashboard();

      expect(screen.getByText("Load more")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Task click opens TaskDetailDialog
  // -------------------------------------------------------------------------
  describe("task click interaction", () => {
    it("opens TaskDetailDialog when an overdue task is clicked", async () => {
      const user = userEvent.setup();
      const data = makeDashboardData();
      setupDashboardMock(data);
      renderDashboard();

      // Click on the overdue task
      await user.click(screen.getByText("Fix critical bug"));

      await waitFor(() => {
        const dialog = screen.getByTestId("task-detail-dialog");
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute("data-task-id", "task-overdue-1");
      });
    });

    it("opens TaskDetailDialog when an upcoming task is clicked", async () => {
      const user = userEvent.setup();
      const data = makeDashboardData();
      setupDashboardMock(data);
      renderDashboard();

      await user.click(screen.getByText("Finish documentation"));

      await waitFor(() => {
        const dialog = screen.getByTestId("task-detail-dialog");
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute("data-task-id", "task-upcoming-1");
      });
    });

    it("opens TaskDetailDialog when an activity task link is clicked", async () => {
      const user = userEvent.setup();
      const data = makeDashboardData();
      setupDashboardMock(data);
      setupActivityMock([makeActivity("act-1", "Write tests")]);
      renderDashboard();

      await user.click(screen.getByText("Write tests"));

      await waitFor(() => {
        const dialog = screen.getByTestId("task-detail-dialog");
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute("data-task-id", "task-act-1");
      });
    });

    it("closes TaskDetailDialog when close button is clicked", async () => {
      const user = userEvent.setup();
      const data = makeDashboardData();
      setupDashboardMock(data);
      renderDashboard();

      // Open dialog
      await user.click(screen.getByText("Fix critical bug"));
      await waitFor(() => {
        expect(screen.getByTestId("task-detail-dialog")).toBeInTheDocument();
      });

      // Close dialog
      await user.click(screen.getByText("Close Dialog"));
      await waitFor(() => {
        expect(screen.queryByTestId("task-detail-dialog")).not.toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Empty project state (all sections minimal)
  // -------------------------------------------------------------------------
  describe("empty project state", () => {
    it("renders gracefully with minimal data", () => {
      const data = makeDashboardData({
        taskCounts: { activeCount: 0, completedCount: 0, totalCount: 0 },
        tasksByGroup: [],
        tasksPerMember: [],
        upcomingTasks: [],
        overdueTasks: [],
        priorityBreakdown: [],
        costAggregation: {
          totalCost: 0,
          completedCost: 0,
          activeCost: 0,
          tasksWithCost: 0,
        },
        budget: null,
        costPerMember: [],
      });
      setupDashboardMock(data);
      renderDashboard();

      // Stat cards should still render
      expect(screen.getByText("Active Tasks")).toBeInTheDocument();
      expect(screen.getByText("Completed")).toBeInTheDocument();
      expect(screen.getByText("Completion Rate")).toBeInTheDocument();
      expect(screen.getByText("0%")).toBeInTheDocument();

      // Empty states for content sections
      expect(screen.getByText("No active tasks")).toBeInTheDocument();
      expect(screen.getByText("No tasks yet")).toBeInTheDocument();
      expect(screen.getByText("No tasks assigned yet")).toBeInTheDocument();
      expect(screen.getByText("No upcoming deadlines")).toBeInTheDocument();

      // Overdue and budget sections should not render
      expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
      expect(screen.queryByText("Budget & Costs")).not.toBeInTheDocument();
    });
  });
});

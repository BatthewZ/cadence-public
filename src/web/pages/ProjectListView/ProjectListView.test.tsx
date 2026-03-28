import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Task, TaskGroup } from "@/web/contexts/ProjectContext";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseProject = vi.fn();

vi.mock("@/web/contexts/ProjectContext", () => ({
  useProject: (): unknown => mockUseProject(),
}));

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws-1", name: "Test Workspace", slug: "test" },
    members: [
      {
        id: "member-1",
        userId: "user-1",
        user: { name: "Alice Smith", image: null },
      },
      {
        id: "member-2",
        userId: "user-2",
        user: { name: "Bob Jones", image: null },
      },
    ],
    teams: [],
    refetch: vi.fn(),
  }),
}));

vi.mock("@/web/hooks/use-task-filters", () => ({
  useTaskFilters: (tasks: Task[]) => ({
    filteredTasks: tasks,
    hasActiveFilters: false,
    clearFilters: vi.fn(),
  }),
}));

vi.mock("@/web/lib/api/client", () => ({
  api: Object.assign(vi.fn(), {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: vi.fn() }),
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
globalThis.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;

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

// Dynamic import so mocks are registered before the module loads
const { default: ProjectListView } = await import("./ProjectListView");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    taskGroupId: "group-1",
    priority: "none",
    completed: false,
    position: "000001",
    ...overrides,
  };
}

function makeTaskGroup(overrides: Partial<TaskGroup> & { id: string; name: string }): TaskGroup {
  return {
    isCompletionGroup: false,
    position: "000001",
    ...overrides,
  };
}

function setupProjectMock(tasks: Task[], taskGroups: TaskGroup[] = [makeTaskGroup({ id: "group-1", name: "To Do" })]) {
  mockUseProject.mockReturnValue({
    project: { id: "proj-1", name: "Test Project", status: "active", workspaceId: "ws-1" },
    members: [],
    taskGroups,
    tasks,
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

/**
 * Sets the search input value in one shot via fireEvent.change, avoiding
 * the per-keystroke overhead of userEvent.type which causes timeouts in jsdom.
 */
function setSearchValue(value: string) {
  const searchInput = screen.getByRole("searchbox");
  fireEvent.change(searchInput, { target: { value } });
}

function renderComponent() {
  const Wrapper = createWrapper();
  return render(
    <Wrapper>
      <ProjectListView />
    </Wrapper>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProjectListView", () => {
  // -------------------------------------------------------------------------
  // 1. Renders DataTable with task columns (name, status, priority, due date)
  // -------------------------------------------------------------------------
  describe("renders DataTable with task columns", () => {
    it("displays column headers for Title, Group, Assigned to, Priority, Status, Due Date", () => {
      setupProjectMock([
        makeTask({ id: "t-1", title: "First task" }),
      ]);
      renderComponent();

      expect(screen.getByText("Title")).toBeInTheDocument();
      expect(screen.getByText("Group")).toBeInTheDocument();
      expect(screen.getByText("Assigned to")).toBeInTheDocument();
      expect(screen.getByText("Priority")).toBeInTheDocument();
      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.getByText("Due Date")).toBeInTheDocument();
    });

    it("renders task title, priority badge, group badge, and due date", () => {
      const tasks = [
        makeTask({
          id: "t-1",
          title: "Design mockups",
          priority: "high",
          taskGroupId: "group-1",
          dueDate: "2026-04-15",
        }),
      ];
      const groups = [makeTaskGroup({ id: "group-1", name: "In Progress" })];
      setupProjectMock(tasks, groups);
      renderComponent();

      expect(screen.getByText("Design mockups")).toBeInTheDocument();
      expect(screen.getByText("High")).toBeInTheDocument();
      expect(screen.getByText("In Progress")).toBeInTheDocument();
      // Due date gets formatted via toLocaleDateString — just check it's not "-"
      const dateCell = screen.getByText(new Date("2026-04-15").toLocaleDateString());
      expect(dateCell).toBeInTheDocument();
    });

    it("renders multiple tasks as table rows", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Task Alpha", position: "000001" }),
        makeTask({ id: "t-2", title: "Task Beta", position: "000002" }),
        makeTask({ id: "t-3", title: "Task Gamma", position: "000003" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      expect(screen.getByText("Task Alpha")).toBeInTheDocument();
      expect(screen.getByText("Task Beta")).toBeInTheDocument();
      expect(screen.getByText("Task Gamma")).toBeInTheDocument();
    });

    it("shows assignee name and avatar when task has an assignee", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Assigned task", assigneeId: "user-1" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    });

    it('shows "Unassigned" when task has no assignee', () => {
      const tasks = [
        makeTask({ id: "t-1", title: "No assignee task", assigneeId: null }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      expect(screen.getByText("Unassigned")).toBeInTheDocument();
    });

    it("shows dash when task has no group", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "No group task", taskGroupId: "nonexistent" }),
      ];
      setupProjectMock(tasks, []);
      renderComponent();

      // Both group column and due date column render "-" when empty,
      // so we verify at least one muted dash exists for the group column.
      const dashes = screen.getAllByText("-");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
      // The group dash has the text-fg-muted class
      const groupDash = dashes.find((el) => el.classList.contains("text-fg-muted"));
      expect(groupDash).toBeDefined();
    });

    it("shows dash for due date when task has no due date", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "No due date task", dueDate: null }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      // formatDate returns "-" for null/undefined
      const dashes = screen.getAllByText("-");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Shows empty state when project has no tasks
  // -------------------------------------------------------------------------
  describe("empty state", () => {
    it('shows "No tasks yet" empty state when project has zero tasks', () => {
      setupProjectMock([]);
      renderComponent();

      expect(screen.getByText("No tasks yet")).toBeInTheDocument();
      expect(screen.getByText("Create your first task to get started.")).toBeInTheDocument();
    });

    it('shows "No matching tasks" when search yields no results', () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Build feature" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      // Verify the task is initially visible
      expect(screen.getByText("Build feature")).toBeInTheDocument();

      // Set a search query that matches nothing
      setSearchValue("zzzzz nonexistent");

      expect(screen.getByText("No matching tasks")).toBeInTheDocument();
      expect(screen.getByText("Try adjusting your search query.")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Search/filter input filters displayed tasks
  // -------------------------------------------------------------------------
  describe("search filtering", () => {
    it("filters tasks by title when search value changes", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Design mockups", position: "000001" }),
        makeTask({ id: "t-2", title: "Implement API", position: "000002" }),
        makeTask({ id: "t-3", title: "Write tests", position: "000003" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      // All tasks visible initially
      expect(screen.getByText("Design mockups")).toBeInTheDocument();
      expect(screen.getByText("Implement API")).toBeInTheDocument();
      expect(screen.getByText("Write tests")).toBeInTheDocument();

      setSearchValue("Design");

      expect(screen.getByText("Design mockups")).toBeInTheDocument();
      expect(screen.queryByText("Implement API")).not.toBeInTheDocument();
      expect(screen.queryByText("Write tests")).not.toBeInTheDocument();
    });

    it("filters tasks by assignee name", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Task for Alice", assigneeId: "user-1", position: "000001" }),
        makeTask({ id: "t-2", title: "Task for Bob", assigneeId: "user-2", position: "000002" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      setSearchValue("Bob");

      expect(screen.queryByText("Task for Alice")).not.toBeInTheDocument();
      expect(screen.getByText("Task for Bob")).toBeInTheDocument();
    });

    it("filters tasks by group name", () => {
      const groups = [
        makeTaskGroup({ id: "g-1", name: "Backlog", position: "000001" }),
        makeTaskGroup({ id: "g-2", name: "Sprint", position: "000002" }),
      ];
      const tasks = [
        makeTask({ id: "t-1", title: "Backlog item", taskGroupId: "g-1", position: "000001" }),
        makeTask({ id: "t-2", title: "Sprint item", taskGroupId: "g-2", position: "000002" }),
      ];
      setupProjectMock(tasks, groups);
      renderComponent();

      setSearchValue("Sprint");

      expect(screen.queryByText("Backlog item")).not.toBeInTheDocument();
      expect(screen.getByText("Sprint item")).toBeInTheDocument();
    });

    it("search is case-insensitive", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Important Task" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      setSearchValue("important");

      expect(screen.getByText("Important Task")).toBeInTheDocument();
    });

    it("shows all tasks again when search is cleared", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Alpha task", position: "000001" }),
        makeTask({ id: "t-2", title: "Beta task", position: "000002" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      // Filter to only Alpha
      setSearchValue("Alpha");
      expect(screen.queryByText("Beta task")).not.toBeInTheDocument();

      // Clear the search
      setSearchValue("");

      expect(screen.getByText("Alpha task")).toBeInTheDocument();
      expect(screen.getByText("Beta task")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Bulk action bar appears when tasks are selected
  // -------------------------------------------------------------------------
  describe("bulk selection and action bar", () => {
    it("shows bulk action bar with selection count when tasks are selected via checkbox", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t-1", title: "Task One", position: "000001" }),
        makeTask({ id: "t-2", title: "Task Two", position: "000002" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      // The DataTable renders checkboxes with aria-label "Select row <key>"
      const checkbox1 = screen.getByRole("checkbox", { name: "Select row t-1" });
      await user.click(checkbox1);

      await waitFor(() => {
        expect(screen.getByText("1 selected")).toBeInTheDocument();
      });

      // The bulk action toolbar should be visible
      const toolbar = screen.getByRole("toolbar", { name: "Bulk actions" });
      expect(toolbar).toBeInTheDocument();
    });

    it("updates selected count when multiple tasks are selected", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t-1", title: "Task One", position: "000001" }),
        makeTask({ id: "t-2", title: "Task Two", position: "000002" }),
        makeTask({ id: "t-3", title: "Task Three", position: "000003" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      const checkbox1 = screen.getByRole("checkbox", { name: "Select row t-1" });
      const checkbox2 = screen.getByRole("checkbox", { name: "Select row t-2" });

      await user.click(checkbox1);
      await user.click(checkbox2);

      await waitFor(() => {
        expect(screen.getByText("2 selected")).toBeInTheDocument();
      });
    });

    it("hides bulk action bar when selection is cleared", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t-1", title: "Task One" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      const checkbox = screen.getByRole("checkbox", { name: "Select row t-1" });

      // Select
      await user.click(checkbox);
      await waitFor(() => {
        expect(screen.getByText("1 selected")).toBeInTheDocument();
      });

      // Deselect
      await user.click(checkbox);
      await waitFor(() => {
        expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
      });
    });

    it("select-all checkbox selects all visible tasks", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t-1", title: "Task One", position: "000001" }),
        makeTask({ id: "t-2", title: "Task Two", position: "000002" }),
        makeTask({ id: "t-3", title: "Task Three", position: "000003" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      const selectAll = screen.getByRole("checkbox", { name: "Select all rows" });
      await user.click(selectAll);

      await waitFor(() => {
        expect(screen.getByText("3 selected")).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 6. Status indicators show correct visual treatment
  // -------------------------------------------------------------------------
  describe("status indicators", () => {
    it('shows "Done" status with success styling for completed tasks', () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Completed task", completed: true }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      const doneStatus = screen.getByText("Done");
      expect(doneStatus).toBeInTheDocument();
      // Verify success color class on the parent span
      const statusSpan = doneStatus.closest("span");
      expect(statusSpan).toHaveClass("text-status-success");
    });

    it('shows "Active" status with muted styling for incomplete tasks', () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Active task", completed: false }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      const activeStatus = screen.getByText("Active");
      expect(activeStatus).toBeInTheDocument();
      const statusSpan = activeStatus.closest("span");
      expect(statusSpan).toHaveClass("text-fg-muted");
    });

    it("renders correct status for mixed completed and active tasks", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Done task", completed: true, position: "000001" }),
        makeTask({ id: "t-2", title: "Active task", completed: false, position: "000002" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      const doneStatuses = screen.getAllByText("Done");
      const activeStatuses = screen.getAllByText("Active");

      expect(doneStatuses).toHaveLength(1);
      expect(activeStatuses).toHaveLength(1);

      expect(doneStatuses[0].closest("span")).toHaveClass("text-status-success");
      expect(activeStatuses[0].closest("span")).toHaveClass("text-fg-muted");
    });

    it("displays all priority levels with correct labels", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Urgent task", priority: "urgent", position: "000001" }),
        makeTask({ id: "t-2", title: "High task", priority: "high", position: "000002" }),
        makeTask({ id: "t-3", title: "Medium task", priority: "medium", position: "000003" }),
        makeTask({ id: "t-4", title: "Low task", priority: "low", position: "000004" }),
        makeTask({ id: "t-5", title: "None task", priority: "none", position: "000005" }),
      ];
      setupProjectMock(tasks);
      renderComponent();

      expect(screen.getByText("Urgent")).toBeInTheDocument();
      expect(screen.getByText("High")).toBeInTheDocument();
      expect(screen.getByText("Medium")).toBeInTheDocument();
      expect(screen.getByText("Low")).toBeInTheDocument();
      expect(screen.getByText("None")).toBeInTheDocument();
    });
  });
});

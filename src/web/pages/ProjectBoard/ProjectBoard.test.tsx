import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task, TaskGroup } from "@/web/contexts/ProjectContext";

import ProjectBoard, { COLUMN_TASK_LIMIT } from "./ProjectBoard";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseProject = vi.fn();

vi.mock("@/web/contexts/ProjectContext", () => ({
  useProject: (): unknown => mockUseProject(),
}));

vi.mock("@/web/hooks/use-permissions", () => ({
  useProjectPermissions: () => ({ canEditTasks: true, isProjectAdmin: false }),
}));

vi.mock("@/web/hooks/use-task-filters", () => ({
  useTaskFilters: (tasks: Task[]) => ({
    filteredTasks: tasks,
    hasActiveFilters: false,
    clearFilters: vi.fn(),
  }),
}));

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws-1", name: "Test Workspace", slug: "test" },
    members: [],
    teams: [],
    refetch: vi.fn(),
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

// Track items passed to each SortableContext so we can assert DnD integration
const capturedSortableContextItems: string[][] = [];

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  DragOverlay: () => null,
  KeyboardSensor: class {},
  PointerSensor: class {},
  closestCorners: vi.fn(),
  useSensor: vi.fn(() => undefined),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({
    children,
    items,
  }: {
    children: ReactNode;
    items: string[];
  }) => {
    capturedSortableContextItems.push([...items]);
    return <div data-testid="sortable-context">{children}</div>;
  },
  sortableKeyboardCoordinates: vi.fn(),
  horizontalListSortingStrategy: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  arrayMove: vi.fn(),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(index: number, groupId: string): Task {
  return {
    id: `task-${index}`,
    title: `Task ${index}`,
    taskGroupId: groupId,
    priority: "none",
    completed: false,
    position: String(index).padStart(6, "0"),
  };
}

function makeTasks(count: number, groupId: string): Task[] {
  return Array.from({ length: count }, (_, i) => makeTask(i + 1, groupId));
}

function makeGroup(
  id: string,
  name: string,
  position: string,
): TaskGroup {
  return { id, name, isCompletionGroup: false, position };
}

function setupProjectMock(groups: TaskGroup[], tasks: Task[]) {
  mockUseProject.mockReturnValue({
    project: { id: "proj-1", name: "Test Project" },
    members: [],
    taskGroups: groups,
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

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectBoard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedSortableContextItems.length = 0;
});

describe("Board column task cap", () => {
  const group = makeGroup("g1", "To Do", "a");

  // -----------------------------------------------------------------------
  // Group A: Rendering Limit Tests
  // -----------------------------------------------------------------------

  describe("rendering limits", () => {
    it("renders all tasks when column has fewer than COLUMN_TASK_LIMIT tasks", () => {
      const tasks = makeTasks(10, "g1");
      setupProjectMock([group], tasks);
      renderBoard();

      for (let i = 1; i <= 10; i++) {
        expect(screen.getByText(`Task ${i}`)).toBeInTheDocument();
      }

      expect(screen.queryByText(/Show .* more task/)).not.toBeInTheDocument();
    });

    it("renders all tasks when column has exactly COLUMN_TASK_LIMIT tasks", () => {
      const tasks = makeTasks(COLUMN_TASK_LIMIT, "g1");
      setupProjectMock([group], tasks);
      renderBoard();

      for (let i = 1; i <= COLUMN_TASK_LIMIT; i++) {
        expect(screen.getByText(`Task ${i}`)).toBeInTheDocument();
      }

      expect(screen.queryByText(/Show .* more task/)).not.toBeInTheDocument();
    });

    it("renders only COLUMN_TASK_LIMIT tasks when column has more", () => {
      const totalTasks = 45;
      const tasks = makeTasks(totalTasks, "g1");
      setupProjectMock([group], tasks);
      renderBoard();

      // First 30 should be visible
      for (let i = 1; i <= COLUMN_TASK_LIMIT; i++) {
        expect(screen.getByText(`Task ${i}`)).toBeInTheDocument();
      }

      // Task 31+ should NOT be visible
      for (let i = COLUMN_TASK_LIMIT + 1; i <= totalTasks; i++) {
        expect(screen.queryByText(`Task ${i}`)).not.toBeInTheDocument();
      }
    });

    it("shows total task count in the column header badge, not visible count", () => {
      const totalTasks = 45;
      const tasks = makeTasks(totalTasks, "g1");
      setupProjectMock([group], tasks);
      renderBoard();

      // The Badge should show the total count (45), not just visible (30)
      expect(screen.getByText(String(totalTasks))).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Group B: "Show More" Button Tests
  // -----------------------------------------------------------------------

  describe('"Show more" button', () => {
    it("displays correct hidden count text", () => {
      const totalTasks = 45;
      const hiddenCount = totalTasks - COLUMN_TASK_LIMIT;
      const tasks = makeTasks(totalTasks, "g1");
      setupProjectMock([group], tasks);
      renderBoard();

      expect(
        screen.getByText(`Show ${hiddenCount} more tasks`),
      ).toBeInTheDocument();
    });

    it("uses correct singular form when only 1 task is hidden", () => {
      const tasks = makeTasks(COLUMN_TASK_LIMIT + 1, "g1");
      setupProjectMock([group], tasks);
      renderBoard();

      expect(screen.getByText("Show 1 more task")).toBeInTheDocument();
    });

    it("uses plural form when multiple tasks are hidden", () => {
      const tasks = makeTasks(COLUMN_TASK_LIMIT + 5, "g1");
      setupProjectMock([group], tasks);
      renderBoard();

      expect(screen.getByText("Show 5 more tasks")).toBeInTheDocument();
    });

    it("reveals all tasks when clicked", async () => {
      const user = userEvent.setup();
      const totalTasks = 45;
      const tasks = makeTasks(totalTasks, "g1");
      setupProjectMock([group], tasks);
      renderBoard();

      // Verify some tasks are hidden
      expect(screen.queryByText(`Task ${totalTasks}`)).not.toBeInTheDocument();

      // Click "Show more"
      const showMoreBtn = screen.getByText(/Show \d+ more tasks/);
      await user.click(showMoreBtn);

      // All tasks should now be visible
      for (let i = 1; i <= totalTasks; i++) {
        expect(screen.getByText(`Task ${i}`)).toBeInTheDocument();
      }

      // "Show more" button should disappear
      expect(screen.queryByText(/Show .* more task/)).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Group C: SortableContext Integration Tests
  // -----------------------------------------------------------------------

  describe("SortableContext integration", () => {
    it("provides only visible task IDs to SortableContext when collapsed", () => {
      const totalTasks = 45;
      const tasks = makeTasks(totalTasks, "g1");
      setupProjectMock([group], tasks);
      renderBoard();

      // Find the SortableContext that received task IDs (not group IDs).
      // Group-level SortableContext has items like "group-g1".
      // Column-level SortableContext has items like "task-task-1".
      const taskContextCaptures = capturedSortableContextItems.filter(
        (items) => items.length > 0 && items[0].startsWith("task-"),
      );

      expect(taskContextCaptures.length).toBeGreaterThan(0);
      const lastTaskCapture = taskContextCaptures[taskContextCaptures.length - 1];
      expect(lastTaskCapture).toHaveLength(COLUMN_TASK_LIMIT);
    });

    it("provides all task IDs to SortableContext after expanding", async () => {
      const user = userEvent.setup();
      const totalTasks = 45;
      const tasks = makeTasks(totalTasks, "g1");
      setupProjectMock([group], tasks);
      renderBoard();

      // Expand the column
      const showMoreBtn = screen.getByText(/Show \d+ more tasks/);
      await user.click(showMoreBtn);

      // After expansion, the last captured task context should have all IDs
      const taskContextCaptures = capturedSortableContextItems.filter(
        (items) => items.length > 0 && items[0].startsWith("task-"),
      );

      const lastTaskCapture = taskContextCaptures[taskContextCaptures.length - 1];
      expect(lastTaskCapture).toHaveLength(totalTasks);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple columns
  // -----------------------------------------------------------------------

  describe("multiple columns", () => {
    it("each column independently tracks its own expansion state", async () => {
      const user = userEvent.setup();
      const group1 = makeGroup("g1", "To Do", "a");
      const group2 = makeGroup("g2", "In Progress", "b");

      const tasksG1 = makeTasks(35, "g1");
      const tasksG2 = Array.from({ length: 40 }, (_, i) => ({
        ...makeTask(100 + i + 1, "g2"),
        title: `Progress ${i + 1}`,
      }));
      const allTasks = [...tasksG1, ...tasksG2];

      setupProjectMock([group1, group2], allTasks);
      renderBoard();

      // Both columns show "Show more" buttons
      const showMoreBtns = screen.getAllByText(/Show \d+ more task/);
      expect(showMoreBtns).toHaveLength(2);

      // Expand only the first column (5 hidden tasks)
      const g1Btn = screen.getByText("Show 5 more tasks");
      await user.click(g1Btn);

      // After expanding G1, only G2 should still have a "Show more" button
      const remaining = screen.getAllByText(/Show \d+ more task/);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].textContent).toBe("Show 10 more tasks");
    });
  });
});

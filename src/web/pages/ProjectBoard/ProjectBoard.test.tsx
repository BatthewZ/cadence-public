import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task, TaskGroup } from "@/web/contexts/ProjectContext";
import { api } from "@/web/lib/api/client";

import ProjectBoard, { COLUMN_TASK_LIMIT } from "./ProjectBoard";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseProject = vi.fn();

vi.mock("@/web/contexts/ProjectContext", () => ({
  useProject: (): unknown => mockUseProject(),
}));

// Permissions are stubbed rather than derived from rosters so a test can pick a
// role in one line. Default is the ordinary editing member, which is what every
// test that is not about permissions assumes.
let mockPermissions = { canEditTasks: true, isProjectAdmin: false };

vi.mock("@/web/hooks/use-permissions", () => ({
  useProjectPermissions: () => mockPermissions,
}));

// Spread the real module so EVERY export stays available — TaskCard calls the
// real useTaskFilterControls (so click-to-filter tests exercise genuine URL
// read/write through MemoryRouter), while the board-level useTaskFilters is
// stubbed to a pass-through so filter state never hides cards from the suite.
vi.mock("@/web/hooks/use-task-filters", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/web/hooks/use-task-filters")>();
  return {
    ...actual,
    useTaskFilters: (tasks: Task[]) => ({
      filteredTasks: tasks,
      hasActiveFilters: false,
      clearFilters: vi.fn(),
    }),
  };
});

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
  MouseSensor: class {},
  TouchSensor: class {},
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
  const ctx = {
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
  };
  mockUseProject.mockReturnValue(ctx);
  return ctx;
}

/**
 * Exposes the router's current search string in the DOM so tests can assert
 * on URL state (the single source of truth for filters) — MemoryRouter never
 * touches window.location, so there is nothing else to read it from.
 */
function LocationSpy() {
  return <div data-testid="location-search">{useLocation().search}</div>;
}

function searchParams(): URLSearchParams {
  return new URLSearchParams(
    screen.getByTestId("location-search").textContent ?? "",
  );
}

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectBoard />
        <LocationSpy />
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
  mockPermissions = { canEditTasks: true, isProjectAdmin: false };
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

// ---------------------------------------------------------------------------
// Click-to-filter on card chips
// ---------------------------------------------------------------------------
//
// These tests matter because every chip lives INSIDE a card whose own click
// opens the task detail panel (`?task=<id>`) and whose pointerdown arms
// dnd-kit dragging — a regression in the stopPropagation wiring would make
// "filter by label" silently open the detail panel instead. Asserting the
// `task` param stays absent is the guard for exactly that.
describe("click-to-filter on card chips", () => {
  const group = makeGroup("g1", "To Do", "a");

  function makeFilterableTask(): Task {
    return {
      ...makeTask(1, "g1"),
      priority: "high",
      assigneeId: "user-1",
      assigneeName: "Alice Smith",
      labels: [{ id: "label-1", name: "Bug", color: "#dc2626" }],
    };
  }

  it("clicking the priority indicator toggles the priority filter without opening task detail", async () => {
    const user = userEvent.setup();
    setupProjectMock([group], [makeFilterableTask()]);
    renderBoard();

    const priorityButton = screen.getByRole("button", {
      name: "Filter by priority: High",
    });

    await user.click(priorityButton);
    expect(searchParams().get("priority")).toBe("high");
    expect(searchParams().get("task")).toBeNull();

    // XOR semantics: clicking again removes the value (param disappears).
    await user.click(priorityButton);
    expect(searchParams().get("priority")).toBeNull();
    expect(searchParams().get("task")).toBeNull();
  });

  it("clicking the assignee avatar toggles the assignee filter without opening task detail", async () => {
    const user = userEvent.setup();
    setupProjectMock([group], [makeFilterableTask()]);
    renderBoard();

    const assigneeButton = screen.getByRole("button", {
      name: "Filter by assignee: Alice Smith",
    });

    await user.click(assigneeButton);
    expect(searchParams().get("assignee")).toBe("user-1");
    expect(searchParams().get("task")).toBeNull();

    await user.click(assigneeButton);
    expect(searchParams().get("assignee")).toBeNull();
    expect(searchParams().get("task")).toBeNull();
  });

  it("clicking a label chip toggles the label filter without opening task detail", async () => {
    const user = userEvent.setup();
    setupProjectMock([group], [makeFilterableTask()]);
    renderBoard();

    const labelButton = screen.getByRole("button", {
      name: "Filter by label: Bug",
    });

    await user.click(labelButton);
    expect(searchParams().get("label")).toBe("label-1");
    expect(searchParams().get("task")).toBeNull();

    await user.click(labelButton);
    expect(searchParams().get("label")).toBeNull();
    expect(searchParams().get("task")).toBeNull();
  });

  it("XORs into an existing filter list instead of replacing it", async () => {
    const user = userEvent.setup();
    const taskA = makeFilterableTask();
    const taskB: Task = {
      ...makeTask(2, "g1"),
      priority: "low",
    };
    setupProjectMock([group], [taskA, taskB]);
    renderBoard();

    await user.click(
      screen.getByRole("button", { name: "Filter by priority: High" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Filter by priority: Low" }),
    );

    expect(searchParams().get("priority")).toBe("high,low");

    // Removing one value keeps the other.
    await user.click(
      screen.getByRole("button", { name: "Filter by priority: High" }),
    );
    expect(searchParams().get("priority")).toBe("low");
  });

  it("clicking the card body (not a chip) still opens the task detail", async () => {
    const user = userEvent.setup();
    setupProjectMock([group], [makeFilterableTask()]);
    renderBoard();

    await user.click(screen.getByText("Task 1"));
    expect(searchParams().get("task")).toBe("task-1");
  });

  it("opening the task detail preserves active filter params (regression: object-form setSearchParams wiped them)", async () => {
    // `setSearchParams({ task: id })` REPLACES the whole query string — a
    // user who built up filters via click-to-filter would lose them all the
    // moment they opened a task. The open handler must use the functional
    // updater and only set `task`, so the filter params survive the
    // open/close round-trip (the close handler deletes only `task`).
    const user = userEvent.setup();
    setupProjectMock([group], [makeFilterableTask()]);
    renderBoard();

    // Build filter state first, exactly as a user would.
    await user.click(
      screen.getByRole("button", { name: "Filter by priority: High" }),
    );
    expect(searchParams().get("priority")).toBe("high");

    await user.click(screen.getByText("Task 1"));
    expect(searchParams().get("task")).toBe("task-1");
    expect(searchParams().get("priority")).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Within-column reorder via the card menu (non-drag fallback)
// ---------------------------------------------------------------------------
//
// These tests guard the menu-driven "Move up / Move down" path, which is the
// ONLY way to reorder a task within a column on touch devices (dnd-kit's
// press-and-hold drag is unreliable there, and was the user-reported gap).
// A regression here would silently strand mobile users with no way to reorder.
async function openTaskMenu(user: ReturnType<typeof userEvent.setup>, taskIndex: number) {
  const triggers = screen.getAllByRole("button", { name: "Task actions" });
  await user.click(triggers[taskIndex]);
}

// ---------------------------------------------------------------------------
// Read-only board for project viewers
// ---------------------------------------------------------------------------
//
// A `viewer` holds read access only, so every entry behind the card's hover
// "..." menu (priority, assignee, move to group, reorder, due date, delete) is
// a write the API will reject. Rendering the trigger would advertise actions
// that dead-end in an error toast, so the whole menu is withheld — the cards
// themselves must still render, because viewing is exactly what the role is for.
describe("viewer permissions", () => {
  const group = makeGroup("g1", "To Do", "a");

  it("hides the card actions menu when the user cannot edit tasks", () => {
    mockPermissions = { canEditTasks: false, isProjectAdmin: false };
    setupProjectMock([group], makeTasks(3, "g1"));
    renderBoard();

    expect(screen.getByText("Task 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Task actions" })).not.toBeInTheDocument();
  });

  it("renders the card actions menu for a user who can edit tasks", () => {
    setupProjectMock([group], makeTasks(3, "g1"));
    renderBoard();

    expect(screen.getAllByRole("button", { name: "Task actions" })).toHaveLength(3);
  });

  // The cursor is the board's only hint that a card or column can be dragged.
  // ProjectBoard builds its sensors with `enabled: canEditTasks`, so for a
  // viewer there is no sensor to arm and a grab cursor would promise a
  // reorder that silently never happens. Cards keep `cursor-pointer` because
  // clicking still opens the detail panel; the column header has no click
  // behaviour of its own, so it drops to the default cursor.
  it("drops the grab cursor on cards and column headers for a viewer", () => {
    mockPermissions = { canEditTasks: false, isProjectAdmin: false };
    setupProjectMock([group], makeTasks(1, "g1"));
    renderBoard();

    const card = screen.getByText("Task 1").closest(".group");
    expect(card).toHaveClass("cursor-pointer");
    expect(card).not.toHaveClass("cursor-grab");
    expect(screen.getByText("To Do")).not.toHaveClass("cursor-grab");
  });

  it("keeps the grab cursor on cards and column headers for an editor", () => {
    setupProjectMock([group], makeTasks(1, "g1"));
    renderBoard();

    const card = screen.getByText("Task 1").closest(".group");
    expect(card).toHaveClass("cursor-grab");
    expect(screen.getByText("To Do")).toHaveClass("cursor-grab");
  });
});

describe("within-column reorder menu", () => {
  const group = makeGroup("g1", "To Do", "a");

  beforeEach(() => {
    // Resolve the move endpoint with a representative task so the optimistic
    // handler's `res.task` apply doesn't throw and fall into the revert branch.
    vi.mocked(api.patch).mockResolvedValue({ task: makeTask(2, "g1") });
  });

  it("renders Move up / Move down items in the card menu", async () => {
    const user = userEvent.setup();
    setupProjectMock([group], makeTasks(3, "g1"));
    renderBoard();

    await openTaskMenu(user, 1); // middle task

    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeInTheDocument();
  });

  // Split into two single-menu tests: an open DropdownMenu traps focus and
  // marks the rest of the page aria-hidden, so opening a second menu in the
  // same test (even after Escape) races the exit transition and hides the
  // other cards' triggers. One menu per render keeps the assertion robust.
  it("disables Move up for the first task (already at the top)", async () => {
    const user = userEvent.setup();
    setupProjectMock([group], makeTasks(3, "g1"));
    renderBoard();

    await openTaskMenu(user, 0);
    expect(screen.getByRole("menuitem", { name: "Move up" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "Move down" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("disables Move down for the last task (already at the bottom)", async () => {
    const user = userEvent.setup();
    setupProjectMock([group], makeTasks(3, "g1"));
    renderBoard();

    await openTaskMenu(user, 2);
    expect(screen.getByRole("menuitem", { name: "Move down" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "Move up" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("Move down on the middle task PATCHes the move endpoint with the same group and a new position", async () => {
    const user = userEvent.setup();
    const ctx = setupProjectMock([group], makeTasks(3, "g1"));
    renderBoard();

    await openTaskMenu(user, 1); // Task 2 (position "000002")
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        "/api/tasks/task-2/move",
        expect.objectContaining({ taskGroupId: "g1" }),
      );
    });

    // New position sorts AFTER the previously-last task (moved past Task 3).
    const moveCall = vi.mocked(api.patch).mock.calls[0] as [
      string,
      { taskGroupId: string; position: string },
    ];
    expect(moveCall[1].position > "000003").toBe(true);

    // The optimistic context update uses the SAME position that gets persisted,
    // so it should have fired for the moved task before the request resolved.
    expect(ctx.updateTask).toHaveBeenCalledWith("task-2", {
      position: moveCall[1].position,
    });
  });

  it("Move up on the middle task computes a position between the two preceding tasks", async () => {
    const user = userEvent.setup();
    setupProjectMock([group], makeTasks(3, "g1"));
    renderBoard();

    await openTaskMenu(user, 1); // Task 2
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        "/api/tasks/task-2/move",
        expect.objectContaining({ taskGroupId: "g1" }),
      );
    });

    // Moving up past Task 1 → new position sorts BEFORE Task 1 ("000001").
    const moveCall = vi.mocked(api.patch).mock.calls[0] as [
      string,
      { taskGroupId: string; position: string },
    ];
    expect(moveCall[1].position < "000001").toBe(true);
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@/web/contexts/ProjectContext";

// ---------------------------------------------------------------------------
// Mocks — declared before any imports that depend on them
// ---------------------------------------------------------------------------

const mockUseProject = vi.fn();

vi.mock("@/web/contexts/ProjectContext", () => ({
  useProject: (): unknown => mockUseProject(),
}));

/**
 * Workspace roster `useProjectPermissions` reads. Empty by default, which puts
 * the hook on its "roster has not arrived" branch — deliberately permissive, so
 * every test that is not about permissions keeps the editing affordances it
 * asserts on. The viewer test fills this in so the hook takes the real
 * role-lookup path instead.
 */
let mockWorkspaceMembers: Array<{ userId: string; role: string }> = [];

// `policy` is imported rather than spelled out because `useWorkspacePermissions`
// dereferences `workspace.policy.allowMemberProjectCreation` unconditionally:
// the context's contract is that it always hands over a fully-resolved policy,
// and a mock that omits it crashes the hook instead of exercising it. Async
// factory because `vi.mock` is hoisted above the import list.
vi.mock("@/web/contexts/WorkspaceContext", async () => {
  const { DEFAULT_WORKSPACE_POLICY } = await import("@/shared/types/workspace-policy");
  return {
    useWorkspace: () => ({
      workspace: {
        id: "ws-1",
        name: "Test Workspace",
        slug: "test",
        policy: DEFAULT_WORKSPACE_POLICY,
      },
      members: mockWorkspaceMembers,
      teams: [],
      refetch: vi.fn(),
    }),
  };
});

let mockCompletedFilter: boolean | null = null;

vi.mock("@/web/hooks/use-task-filters", () => ({
  useTaskFilters: (tasks: Task[]) => ({
    filteredTasks: tasks,
    filters: { assigneeIds: [], priorities: [], get completed() { return mockCompletedFilter; }, dueDateFrom: null, dueDateTo: null, labelIds: [] },
    hasActiveFilters: false,
    clearFilters: vi.fn(),
  }),
}));

vi.mock("@/web/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: vi.fn() }),
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

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1", name: "Alice", email: "alice@test.com", image: null },
    },
  }),
}));

import { api } from "@/web/lib/api/client";
const mockPost = api.post as ReturnType<typeof vi.fn>;
const mockPatch = api.patch as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Polyfills for jsdom
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Dynamic import so mocks are established first
// ---------------------------------------------------------------------------

const { default: ProjectTimeline } = await import("./ProjectTimeline");

// ---------------------------------------------------------------------------
// Date helpers — produce ISO date strings relative to a fixed "now"
// ---------------------------------------------------------------------------

/** Returns a local date string N days from today (negative = past). */
function daysFromNow(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    taskGroupId: "tg-1",
    priority: "none",
    completed: false,
    position: "000001",
    ...overrides,
  };
}

/**
 * @param selfRole Project role of the signed-in user (`user-1`). Only matters
 * once `mockWorkspaceMembers` is populated — until then the permission hook
 * short-circuits to its permissive loading placeholder.
 */
function setupProjectMock(tasks: Task[], selfRole = "admin") {
  mockUseProject.mockReturnValue({
    project: { id: "proj-1", name: "Test Project", workspaceId: "ws-1" },
    members: [
      { id: "m-1", userId: "user-1", name: "Alice", email: "alice@test.com", image: null, role: selfRole, joinedAt: "2025-01-01" },
      { id: "m-2", userId: "user-2", name: "Bob", email: "bob@test.com", image: null, role: "member", joinedAt: "2025-01-01" },
    ],
    taskGroups: [
      { id: "tg-1", name: "To Do", isCompletionGroup: false, position: "a" },
      { id: "tg-2", name: "Done", isCompletionGroup: true, position: "b" },
    ],
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

function renderTimeline(initialEntries: string[] = ["/"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <ProjectTimeline />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockCompletedFilter = null;
  mockWorkspaceMembers = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectTimeline", () => {
  // -----------------------------------------------------------------------
  // 1. Time bucket grouping
  // -----------------------------------------------------------------------
  describe("time bucket grouping", () => {
    it("groups overdue tasks into the Overdue bucket", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Overdue task", dueDate: daysFromNow(-3) }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByText("Overdue")).toBeInTheDocument();
      expect(screen.getByText("Overdue task")).toBeInTheDocument();
    });

    it("groups tasks due today into the Today bucket", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Today task", dueDate: daysFromNow(0) }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getAllByText("Today").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Today task")).toBeInTheDocument();
    });

    it("groups tasks due later this week into This Week bucket", () => {
      // Find a day that is strictly after today but within this week (Sunday end).
      // We use +2 days, but if that crosses the week boundary we still verify the bucket renders.
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0=Sun
      // Pick a date later this week. If today is Saturday (6) or Sunday (0), +2 might
      // go into next week, so use +1 as fallback within the same week.
      const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
      // Only test this if there are days remaining in the week after today
      if (daysUntilSunday >= 2) {
        const tasks = [
          makeTask({ id: "t-1", title: "This week task", dueDate: daysFromNow(2) }),
        ];
        setupProjectMock(tasks);
        renderTimeline();
        expect(screen.getByText("This Week")).toBeInTheDocument();
        expect(screen.getByText("This week task")).toBeInTheDocument();
      }
    });

    it("places tasks without a due date in the Unscheduled bucket", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "No date task", dueDate: null }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByText("Unscheduled")).toBeInTheDocument();
      expect(screen.getByText("No date task")).toBeInTheDocument();
    });

    it("places tasks far in the future into the Later bucket", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Far future task", dueDate: daysFromNow(90) }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByText("Later")).toBeInTheDocument();
      expect(screen.getByText("Far future task")).toBeInTheDocument();
    });

    it("distributes tasks into multiple buckets correctly", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Overdue one", dueDate: daysFromNow(-5) }),
        makeTask({ id: "t-2", title: "Today one", dueDate: daysFromNow(0) }),
        makeTask({ id: "t-3", title: "No date one", dueDate: null }),
        makeTask({ id: "t-4", title: "Way later", dueDate: daysFromNow(120) }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByText("Overdue")).toBeInTheDocument();
      expect(screen.getAllByText("Today").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Unscheduled")).toBeInTheDocument();
      expect(screen.getByText("Later")).toBeInTheDocument();

      expect(screen.getByText("Overdue one")).toBeInTheDocument();
      expect(screen.getByText("Today one")).toBeInTheDocument();
      expect(screen.getByText("No date one")).toBeInTheDocument();
      expect(screen.getByText("Way later")).toBeInTheDocument();
    });

    it("shows task counts as badges in each bucket header", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Overdue A", dueDate: daysFromNow(-2) }),
        makeTask({ id: "t-2", title: "Overdue B", dueDate: daysFromNow(-1) }),
        makeTask({ id: "t-3", title: "No date X", dueDate: null }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      // The Overdue bucket should display count "2"
      const overdueSection = screen.getByText("Overdue").closest(".accordion-item");
      expect(overdueSection).not.toBeNull();
      expect(within(overdueSection! as HTMLElement).getByText("2")).toBeInTheDocument();

      // The Unscheduled bucket should display count "1"
      const unscheduledSection = screen.getByText("Unscheduled").closest(".accordion-item");
      expect(unscheduledSection).not.toBeNull();
      expect(within(unscheduledSection! as HTMLElement).getByText("1")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Unscheduled section
  // -----------------------------------------------------------------------
  describe("Unscheduled section", () => {
    it("renders the CalendarOff icon for unscheduled section", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "No date", dueDate: null }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      // The unscheduled trigger has a muted text class
      const trigger = screen.getByText("Unscheduled").closest("button");
      expect(trigger).not.toBeNull();
      expect(trigger!.className).toContain("text-fg-muted");
    });

    it("shows multiple unscheduled tasks", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Backlog A", dueDate: null }),
        makeTask({ id: "t-2", title: "Backlog B", dueDate: null }),
        makeTask({ id: "t-3", title: "Backlog C", dueDate: null }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByText("Backlog A")).toBeInTheDocument();
      expect(screen.getByText("Backlog B")).toBeInTheDocument();
      expect(screen.getByText("Backlog C")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 3. Task row display
  // -----------------------------------------------------------------------
  describe("task row display", () => {
    it("renders task title", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Important task", dueDate: daysFromNow(0) }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByText("Important task")).toBeInTheDocument();
    });

    it("renders assignee avatar when assigned", () => {
      const tasks = [
        makeTask({
          id: "t-1",
          title: "Assigned task",
          dueDate: daysFromNow(0),
          assigneeId: "user-1",
          assigneeName: "Alice",
        }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByLabelText("Change assigned person")).toBeInTheDocument();
    });

    it("renders assign button when unassigned", () => {
      const tasks = [
        makeTask({
          id: "t-1",
          title: "Unassigned task",
          dueDate: daysFromNow(0),
          assigneeId: null,
          assigneeName: undefined,
        }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByLabelText("Assign task")).toBeInTheDocument();
    });

    it("renders priority badge for high-priority tasks", () => {
      const tasks = [
        makeTask({
          id: "t-1",
          title: "Urgent task",
          dueDate: daysFromNow(0),
          priority: "high",
        }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByText("High")).toBeInTheDocument();
    });

    it("renders formatted due date", () => {
      const dueDate = daysFromNow(30);
      const tasks = [
        makeTask({ id: "t-1", title: "Dated task", dueDate }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      // formatDueDate returns "Mon DD" for dates > 7 days away
      const dateObj = new Date(dueDate);
      const expected = dateObj.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it("applies line-through styling to completed tasks", () => {
      mockCompletedFilter = true; // show completed tasks via Status filter
      const tasks = [
        makeTask({
          id: "t-1",
          title: "Done task",
          dueDate: daysFromNow(0),
          completed: true,
        }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      const title = screen.getByText("Done task");
      expect(title.className).toContain("line-through");
    });
  });

  // -----------------------------------------------------------------------
  // 4. Checkbox toggles task completion
  // -----------------------------------------------------------------------
  describe("checkbox toggle", () => {
    it("calls updateTask optimistically when checkbox is clicked", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t-1", title: "Toggle me", dueDate: daysFromNow(0), completed: false }),
      ];
      setupProjectMock(tasks);
      const mockUpdateTask = (mockUseProject() as { updateTask: ReturnType<typeof vi.fn> }).updateTask;

      // Mock the API post for completing a task
      mockPost.mockResolvedValueOnce({
        task: { ...tasks[0], completed: true },
      });

      renderTimeline();

      const checkbox = screen.getByRole("checkbox", { name: /Mark "Toggle me" as complete/ });
      await user.click(checkbox);

      // updateTask should have been called with completed: true (optimistic)
      expect(mockUpdateTask).toHaveBeenCalledWith("t-1", { completed: true });
    });

    it("calls the complete endpoint when checking an incomplete task", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t-1", title: "Complete me", dueDate: daysFromNow(0), completed: false }),
      ];
      setupProjectMock(tasks);

      mockPost.mockResolvedValueOnce({
        task: { ...tasks[0], completed: true },
      });

      renderTimeline();

      const checkbox = screen.getByRole("checkbox", { name: /Mark "Complete me" as complete/ });
      await user.click(checkbox);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith("/api/tasks/t-1/complete", {});
      });
    });

    it("calls the uncomplete endpoint when unchecking a completed task", async () => {
      mockCompletedFilter = true; // show completed tasks via Status filter
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t-1", title: "Undo me", dueDate: daysFromNow(0), completed: true }),
      ];
      setupProjectMock(tasks);

      mockPost.mockResolvedValueOnce({
        task: { ...tasks[0], completed: false },
      });

      renderTimeline();

      const checkbox = screen.getByRole("checkbox", { name: /Mark "Undo me" as incomplete/ });
      await user.click(checkbox);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith("/api/tasks/t-1/uncomplete", {});
      });
    });
  });

  // -----------------------------------------------------------------------
  // 5. Dropdown menus (priority, assign, actions)
  // -----------------------------------------------------------------------
  describe("dropdown menus", () => {
    it("shows priority options in the priority dropdown", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t-1", title: "Priority task", dueDate: daysFromNow(0), priority: "none" }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      const priorityTrigger = screen.getByLabelText("Set priority");
      await user.click(priorityTrigger);

      await waitFor(() => {
        expect(screen.getByText("Set priority")).toBeInTheDocument();
        expect(screen.getByText("Urgent")).toBeInTheDocument();
        expect(screen.getByText("Medium")).toBeInTheDocument();
        expect(screen.getByText("Low")).toBeInTheDocument();
      });
    });

    it("calls API to update priority when selected", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t-1", title: "Priority task", dueDate: daysFromNow(0), priority: "none" }),
      ];
      setupProjectMock(tasks);
      mockPatch.mockResolvedValueOnce({});
      renderTimeline();

      const priorityTrigger = screen.getByLabelText("Set priority");
      await user.click(priorityTrigger);

      await waitFor(() => {
        expect(screen.getByText("Urgent")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Urgent"));

      await waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith("/api/tasks/t-1", { priority: "urgent" });
      });
    });

    it("shows assignee options in the assign dropdown", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t-1", title: "Assign task", dueDate: daysFromNow(0) }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      const assignTrigger = screen.getByLabelText("Assign task");
      await user.click(assignTrigger);

      await waitFor(() => {
        expect(screen.getByText("Assign to")).toBeInTheDocument();
        expect(screen.getByText("Unassigned")).toBeInTheDocument();
        expect(screen.getByText("Alice")).toBeInTheDocument();
        expect(screen.getByText("Bob")).toBeInTheDocument();
      });
    });

    it("renders the task actions three-dot menu", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Actions task", dueDate: daysFromNow(0) }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByLabelText("Task actions")).toBeInTheDocument();
    });

    // A `viewer` holds read access only, so every entry behind the three-dot
    // menu (priority, assignee, move to group, due date, delete) is a write the
    // API will reject. Withhold the trigger entirely rather than advertise
    // actions that dead-end in an error toast — while still rendering the row,
    // because viewing is exactly what the role exists for.
    it("hides the task actions menu from a project viewer", () => {
      mockWorkspaceMembers = [{ userId: "user-1", role: "member" }];
      const tasks = [
        makeTask({ id: "t-1", title: "Actions task", dueDate: daysFromNow(0) }),
      ];
      setupProjectMock(tasks, "viewer");
      renderTimeline();

      expect(screen.getByText("Actions task")).toBeInTheDocument();
      expect(screen.queryByLabelText("Task actions")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 5b. Completed task exclusion
  // -----------------------------------------------------------------------
  describe("completed task exclusion", () => {
    it("excludes completed tasks from the timeline by default", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Active task", dueDate: daysFromNow(0), completed: false }),
        makeTask({ id: "t-2", title: "Done task", dueDate: daysFromNow(0), completed: true }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByText("Active task")).toBeInTheDocument();
      expect(screen.queryByText("Done task")).not.toBeInTheDocument();
    });

    it("shows completed tasks when Status filter is set to Completed", () => {
      mockCompletedFilter = true;
      const tasks = [
        makeTask({ id: "t-1", title: "Done task", dueDate: daysFromNow(0), completed: true }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      expect(screen.getByText("Done task")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Empty timeline
  // -----------------------------------------------------------------------
  describe("empty state", () => {
    it("shows empty state when there are no tasks", () => {
      setupProjectMock([]);
      renderTimeline();

      expect(screen.getByText("No tasks")).toBeInTheDocument();
      expect(
        screen.getByText("Create tasks to see them on the timeline"),
      ).toBeInTheDocument();
    });

    it("does not show accordion when there are no tasks", () => {
      setupProjectMock([]);
      renderTimeline();

      expect(screen.queryByRole("region")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Accordion expand/collapse
  // -----------------------------------------------------------------------
  describe("accordion expand/collapse", () => {
    it("auto-expands Overdue and Today buckets by default", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Overdue task", dueDate: daysFromNow(-2) }),
        makeTask({ id: "t-2", title: "Today task", dueDate: daysFromNow(0) }),
        makeTask({ id: "t-3", title: "Later task", dueDate: daysFromNow(90) }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      // Overdue trigger should be expanded
      const overdueTrigger = screen.getByText("Overdue").closest("button");
      expect(overdueTrigger).not.toBeNull();
      expect(overdueTrigger!.getAttribute("aria-expanded")).toBe("true");

      // Today trigger should be expanded — find the one inside accordion-trigger-text
      const todayTrigger = screen.getAllByText("Today")
        .find(el => el.closest(".accordion-trigger-text"))
        ?.closest("button");
      expect(todayTrigger).not.toBeNull();
      expect(todayTrigger!.getAttribute("aria-expanded")).toBe("true");

      // Later trigger should NOT be expanded
      const laterTrigger = screen.getByText("Later").closest("button");
      expect(laterTrigger).not.toBeNull();
      expect(laterTrigger!.getAttribute("aria-expanded")).toBe("false");
    });

    it("toggles accordion section when trigger is clicked", async () => {
      const user = userEvent.setup();
      const tasks = [
        makeTask({ id: "t-1", title: "Later task", dueDate: daysFromNow(90) }),
      ];
      setupProjectMock(tasks);
      renderTimeline();

      const laterTrigger = screen.getByText("Later").closest("button");
      expect(laterTrigger).not.toBeNull();

      // Initially closed
      expect(laterTrigger!.getAttribute("aria-expanded")).toBe("false");

      // Click to open
      await user.click(laterTrigger!);
      expect(laterTrigger!.getAttribute("aria-expanded")).toBe("true");

      // Click again to close
      await user.click(laterTrigger!);
      expect(laterTrigger!.getAttribute("aria-expanded")).toBe("false");
    });
  });

  // -----------------------------------------------------------------------
  // 8. Loading / spinner state
  // -----------------------------------------------------------------------
  describe("loading state", () => {
    it("shows a spinner when project is not loaded", () => {
      mockUseProject.mockReturnValue({
        project: null,
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
      renderTimeline();

      // The heading "Timeline" should not appear
      expect(screen.queryByText("Timeline")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 9. Heading
  // -----------------------------------------------------------------------
  describe("page heading", () => {
    it("renders the Timeline heading", () => {
      setupProjectMock([]);
      renderTimeline();

      expect(screen.getByText("Timeline")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 10. GroupBy dropdown
  // -----------------------------------------------------------------------
  describe("GroupBy dropdown", () => {
    it("renders with 'Group: Due Date' by default", () => {
      setupProjectMock([]);
      renderTimeline();

      expect(screen.getByText("Group: Due Date")).toBeInTheDocument();
    });

    it("shows all five grouping options when clicked", async () => {
      const user = userEvent.setup();
      setupProjectMock([]);
      renderTimeline();

      await user.click(screen.getByText("Group: Due Date"));

      await waitFor(() => {
        expect(screen.getByText("Group by")).toBeInTheDocument();
        expect(screen.getByText("Due Date")).toBeInTheDocument();
        expect(screen.getByText("Priority")).toBeInTheDocument();
        expect(screen.getByText("Task Group")).toBeInTheDocument();
        expect(screen.getByText("Assignee")).toBeInTheDocument();
        expect(screen.getByText("Label")).toBeInTheDocument();
      });
    });

    it("shows the correct label when groupBy URL param is set", () => {
      setupProjectMock([]);
      renderTimeline(["/?groupBy=priority"]);

      expect(screen.getByText("Group: Priority")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 11. Priority grouping
  // -----------------------------------------------------------------------
  describe("priority grouping", () => {
    it("groups tasks by priority level in order", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Urgent task", dueDate: daysFromNow(0), priority: "urgent" }),
        makeTask({ id: "t-2", title: "Low task", dueDate: daysFromNow(1), priority: "low" }),
        makeTask({ id: "t-3", title: "High task", dueDate: daysFromNow(2), priority: "high" }),
      ];
      setupProjectMock(tasks);
      renderTimeline(["/?groupBy=priority"]);

      expect(screen.getByText("Urgent task")).toBeInTheDocument();
      expect(screen.getByText("High task")).toBeInTheDocument();
      expect(screen.getByText("Low task")).toBeInTheDocument();
    });

    it("only shows non-empty priority groups", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "High task", dueDate: daysFromNow(0), priority: "high" }),
      ];
      setupProjectMock(tasks);
      renderTimeline(["/?groupBy=priority"]);

      // "High" appears as both the group header badge and the inline priority badge on the task row
      expect(screen.getAllByText("High").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("High task")).toBeInTheDocument();
      // Only one accordion group should be rendered since only "high" priority tasks exist
      const accordionItems = document.querySelectorAll(".accordion-item");
      expect(accordionItems.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 12. Task Group grouping
  // -----------------------------------------------------------------------
  describe("task group grouping", () => {
    it("groups tasks by their task group", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Todo task", taskGroupId: "tg-1", dueDate: daysFromNow(0) }),
        makeTask({ id: "t-2", title: "Done task", taskGroupId: "tg-2", dueDate: daysFromNow(1) }),
      ];
      setupProjectMock(tasks);
      renderTimeline(["/?groupBy=taskGroup"]);

      expect(screen.getByText("To Do")).toBeInTheDocument();
      expect(screen.getByText("Done")).toBeInTheDocument();
      expect(screen.getByText("Todo task")).toBeInTheDocument();
      expect(screen.getByText("Done task")).toBeInTheDocument();
    });

    it("hides empty task groups", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Todo task", taskGroupId: "tg-1", dueDate: daysFromNow(0) }),
      ];
      setupProjectMock(tasks);
      renderTimeline(["/?groupBy=taskGroup"]);

      expect(screen.getByText("To Do")).toBeInTheDocument();
      // "Done" group should not be rendered since no tasks are in it
      expect(screen.queryByText("Done")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 13. Assignee grouping
  // -----------------------------------------------------------------------
  describe("assignee grouping", () => {
    it("groups tasks by assignee with Unassigned last", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Alice task", assigneeId: "user-1", assigneeName: "Alice", dueDate: daysFromNow(0) }),
        makeTask({ id: "t-2", title: "Bob task", assigneeId: "user-2", assigneeName: "Bob", dueDate: daysFromNow(1) }),
        makeTask({ id: "t-3", title: "Orphan task", assigneeId: null, dueDate: daysFromNow(2) }),
      ];
      setupProjectMock(tasks);
      renderTimeline(["/?groupBy=assignee"]);

      expect(screen.getByText("Alice task")).toBeInTheDocument();
      expect(screen.getByText("Bob task")).toBeInTheDocument();
      expect(screen.getByText("Orphan task")).toBeInTheDocument();

      // "Unassigned" section should be present
      expect(screen.getByText("Unassigned")).toBeInTheDocument();

      // Verify order: Alice, Bob, Unassigned (alphabetical with Unassigned last)
      const accordionItems = document.querySelectorAll(".accordion-item");
      expect(accordionItems.length).toBe(3);
    });

    it("hides empty assignee groups", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Alice task", assigneeId: "user-1", assigneeName: "Alice", dueDate: daysFromNow(0) }),
      ];
      setupProjectMock(tasks);
      renderTimeline(["/?groupBy=assignee"]);

      // Only Alice group should appear (not Bob or Unassigned)
      const accordionItems = document.querySelectorAll(".accordion-item");
      expect(accordionItems.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 14. Label grouping
  // -----------------------------------------------------------------------
  describe("label grouping", () => {
    const bugLabel = { id: "l-1", name: "Bug", color: "#ef4444" };
    const featureLabel = { id: "l-2", name: "Feature", color: "#3b82f6" };

    it("groups tasks by label with the No label group last", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Bug task", dueDate: daysFromNow(0), labels: [bugLabel] }),
        makeTask({ id: "t-2", title: "Feature task", dueDate: daysFromNow(1), labels: [featureLabel] }),
        makeTask({ id: "t-3", title: "Plain task", dueDate: daysFromNow(2), labels: [] }),
      ];
      setupProjectMock(tasks);
      renderTimeline(["/?groupBy=label"]);

      expect(screen.getByText("Bug")).toBeInTheDocument();
      expect(screen.getByText("Feature")).toBeInTheDocument();
      expect(screen.getByText("No label")).toBeInTheDocument();

      // All groups auto-expand for label mode, so every task row is visible
      expect(screen.getByText("Bug task")).toBeInTheDocument();
      expect(screen.getByText("Feature task")).toBeInTheDocument();
      expect(screen.getByText("Plain task")).toBeInTheDocument();

      // Three groups, with "No label" rendered last
      const accordionItems = document.querySelectorAll(".accordion-item");
      expect(accordionItems.length).toBe(3);
      const lastItem = accordionItems[accordionItems.length - 1] as HTMLElement;
      expect(within(lastItem).getByText("No label")).toBeInTheDocument();
    });

    it("shows a multi-label task in every matching group with truthful counts", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Dual task", dueDate: daysFromNow(0), labels: [bugLabel, featureLabel] }),
        makeTask({ id: "t-2", title: "Bug only task", dueDate: daysFromNow(1), labels: [bugLabel] }),
      ];
      setupProjectMock(tasks);
      renderTimeline(["/?groupBy=label"]);

      // The dual-labeled task is duplicated into both groups — the honest
      // representation of a many-to-many relation (matches the label
      // filter's OR semantics).
      expect(screen.getAllByText("Dual task").length).toBe(2);

      const accordionItems = document.querySelectorAll(".accordion-item");
      expect(accordionItems.length).toBe(2);

      // Per-group count badges stay truthful: Bug has 2 tasks, Feature has 1
      const bugSection = screen.getByText("Bug").closest(".accordion-item");
      expect(bugSection).not.toBeNull();
      expect(within(bugSection! as HTMLElement).getByText("2")).toBeInTheDocument();

      const featureSection = screen.getByText("Feature").closest(".accordion-item");
      expect(featureSection).not.toBeNull();
      expect(within(featureSection! as HTMLElement).getByText("1")).toBeInTheDocument();
    });

    it("renders the No label header muted, matching the Unscheduled treatment", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Plain task", dueDate: daysFromNow(0) }),
      ];
      setupProjectMock(tasks);
      renderTimeline(["/?groupBy=label"]);

      const trigger = screen.getByText("No label").closest("button");
      expect(trigger).not.toBeNull();
      expect(trigger!.className).toContain("text-fg-muted");
    });

    it("hides label groups with no tasks", () => {
      const tasks = [
        makeTask({ id: "t-1", title: "Bug task", dueDate: daysFromNow(0), labels: [bugLabel] }),
      ];
      setupProjectMock(tasks);
      renderTimeline(["/?groupBy=label"]);

      // Only the Bug group should appear (no Feature, no "No label")
      const accordionItems = document.querySelectorAll(".accordion-item");
      expect(accordionItems.length).toBe(1);
      expect(screen.queryByText("No label")).not.toBeInTheDocument();
    });
  });
});

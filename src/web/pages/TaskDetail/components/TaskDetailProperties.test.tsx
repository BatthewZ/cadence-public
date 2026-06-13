import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, type Mock,vi } from "vitest";

import type { TaskGroup } from "@/web/contexts/ProjectContext";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";

import type { TaskDetailPropertiesProps } from "./TaskDetailProperties";
import { TaskDetailProperties } from "./TaskDetailProperties";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GROUPS: TaskGroup[] = [
  { id: "group-1", name: "To Do", isCompletionGroup: false, position: "a0" },
];

const MEMBERS: WorkspaceMember[] = [
  {
    id: "user-1",
    userId: "user-1",
    role: "admin",
    user: { id: "user-1", name: "Alice", email: "alice@test.com", image: undefined },
  },
];

function makeTask(
  overrides: Partial<TaskDetailPropertiesProps["task"]> = {},
): TaskDetailPropertiesProps["task"] {
  return {
    id: "task-1",
    taskGroupId: "group-1",
    priority: "medium",
    assigneeId: null,
    startDate: null,
    dueDate: null,
    recurrenceRule: null,
    labels: [],
    ...overrides,
  };
}

function makeProps(
  taskOverrides: Partial<TaskDetailPropertiesProps["task"]> = {},
  propOverrides: Partial<TaskDetailPropertiesProps> = {},
): TaskDetailPropertiesProps & { onPatch: Mock<TaskDetailPropertiesProps["onPatch"]> } {
  // Typed against the real prop signature so the mock satisfies the
  // intersection return type without casts (and so call-arg assertions in the
  // tests stay type-checked against the component's actual contract).
  const onPatch = vi.fn<TaskDetailPropertiesProps["onPatch"]>();
  return {
    task: makeTask(taskOverrides),
    taskGroups: GROUPS,
    members: MEMBERS,
    canEditTasks: true,
    costDisplay: "",
    setCostDisplay: () => {},
    onCostFocus: () => {},
    onCostBlur: () => {},
    onGroupChange: () => {},
    // Undefined projectId hides the Labels row so these tests don't need a
    // QueryClientProvider for TaskLabelPicker.
    projectId: undefined,
    ...propOverrides,
    // After the spread: the returned `onPatch` must always BE the mock the
    // test asserts on — an override silently replacing it would make
    // `props.onPatch` assertions vacuous.
    onPatch,
  };
}

/** Date inputs carry no implicit ARIA role, so query them structurally. The
 *  Start row always renders above the Due row, so index 0 = start, 1 = due. */
function getDateInputs(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));
}

/**
 * Tests for the always-visible Start/Due date rows in TaskDetailProperties.
 *
 * Why this matters: start and due are each independently optional, and the
 * panel surfaces BOTH rows at all times — like every other property row —
 * rather than hiding the start date behind a progressive-disclosure
 * affordance. A regression here either re-hides the start date (making it
 * undiscoverable for start-first workflows) or couples the two fields so one
 * can't be set or cleared without the other. The min/max assertions guard the
 * native browser constraint that blocks an inverted range before the
 * server-side Zod refinement ever has to reject the patch.
 */
describe("TaskDetailProperties date rows", () => {
  it("always renders both a Start date and a Due date row, even with no dates set", () => {
    const props = makeProps();
    const { container } = render(<TaskDetailProperties {...props} />);

    expect(screen.getByText("Start date")).toBeInTheDocument();
    expect(screen.getByText("Due date")).toBeInTheDocument();
    const inputs = getDateInputs(container);
    expect(inputs).toHaveLength(2);
    // Both empty by default.
    expect(inputs[0]).toHaveValue("");
    expect(inputs[1]).toHaveValue("");
    // No legacy progressive-disclosure affordance.
    expect(screen.queryByText("+ Add start date")).toBeNull();
  });

  it("shows no clear (×) button on an empty row, but does once that row holds a value", () => {
    const empty = makeProps();
    const { unmount } = render(<TaskDetailProperties {...empty} />);
    // Empty rows reserve an invisible slot (for alignment) but render no button.
    expect(screen.queryByLabelText("Clear start date")).toBeNull();
    expect(screen.queryByLabelText("Clear due date")).toBeNull();
    unmount();

    const filled = makeProps({
      startDate: "2026-06-10T00:00:00.000Z",
      dueDate: "2026-06-20T00:00:00.000Z",
    });
    render(<TaskDetailProperties {...filled} />);
    expect(screen.getByLabelText("Clear start date")).toBeInTheDocument();
    expect(screen.getByLabelText("Clear due date")).toBeInTheDocument();
  });

  it("calls onPatch({ startDate }) when a start date is picked", () => {
    const props = makeProps();
    const { container } = render(<TaskDetailProperties {...props} />);

    const [startInput] = getDateInputs(container);
    fireEvent.change(startInput, { target: { value: "2026-06-15" } });

    expect(props.onPatch).toHaveBeenCalledWith({ startDate: "2026-06-15" });
  });

  it("calls onPatch({ dueDate }) when a due date is picked", () => {
    const props = makeProps();
    const { container } = render(<TaskDetailProperties {...props} />);

    const [, dueInput] = getDateInputs(container);
    fireEvent.change(dueInput, { target: { value: "2026-06-20" } });

    expect(props.onPatch).toHaveBeenCalledWith({ dueDate: "2026-06-20" });
  });

  it("wires native min/max between the two inputs so the browser blocks an inverted range", () => {
    const props = makeProps({
      startDate: "2026-06-10T00:00:00.000Z",
      dueDate: "2026-06-20T00:00:00.000Z",
    });
    const { container } = render(<TaskDetailProperties {...props} />);

    const [startInput, dueInput] = getDateInputs(container);
    expect(startInput).toHaveValue("2026-06-10");
    expect(dueInput).toHaveValue("2026-06-20");
    // start can't pass due, due can't precede start.
    expect(startInput).toHaveAttribute("max", "2026-06-20");
    expect(dueInput).toHaveAttribute("min", "2026-06-10");
  });

  it("renders a start-only task: start filled, due empty, only the start clear button shown", () => {
    const props = makeProps({ startDate: "2026-06-10T00:00:00.000Z", dueDate: null });
    const { container } = render(<TaskDetailProperties {...props} />);

    const [startInput, dueInput] = getDateInputs(container);
    expect(startInput).toHaveValue("2026-06-10");
    expect(dueInput).toHaveValue("");
    // A start date may stand alone — so its input has no max constraint.
    expect(startInput).not.toHaveAttribute("max");
    expect(screen.getByLabelText("Clear start date")).toBeInTheDocument();
    expect(screen.queryByLabelText("Clear due date")).toBeNull();
  });

  it("read-only users see disabled inputs and no clear buttons", () => {
    const props = makeProps(
      { startDate: "2026-06-10T00:00:00.000Z", dueDate: "2026-06-20T00:00:00.000Z" },
      { canEditTasks: false },
    );
    const { container } = render(<TaskDetailProperties {...props} />);

    expect(screen.getByText("Start date")).toBeInTheDocument();
    expect(screen.getByText("Due date")).toBeInTheDocument();
    const [startInput, dueInput] = getDateInputs(container);
    expect(startInput).toBeDisabled();
    expect(dueInput).toBeDisabled();
    expect(screen.queryByLabelText("Clear start date")).toBeNull();
    expect(screen.queryByLabelText("Clear due date")).toBeNull();
  });
});

/**
 * Tests for the independent clear (×) controls.
 *
 * Why this matters: start and due are independently optional, so each × must
 * clear ONLY its own field. The critical regression to guard is the old
 * coupling, where clearing the due date also wiped the start date — that
 * behaviour was correct when a start date required a due date, but is now a
 * bug: a task that begins on a day with no deadline is a valid state the user
 * must be able to reach by clearing just the due date.
 */
describe("TaskDetailProperties independent date clearing", () => {
  it("clears only the start date, leaving the due date intact", async () => {
    const props = makeProps({
      startDate: "2026-06-10T00:00:00.000Z",
      dueDate: "2026-06-20T00:00:00.000Z",
    });
    render(<TaskDetailProperties {...props} />);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Clear start date"));

    expect(props.onPatch).toHaveBeenCalledTimes(1);
    expect(props.onPatch).toHaveBeenCalledWith({ startDate: null });
  });

  it("clears only the due date, leaving a surviving start date in place", async () => {
    const props = makeProps({
      startDate: "2026-06-10T00:00:00.000Z",
      dueDate: "2026-06-20T00:00:00.000Z",
    });
    render(<TaskDetailProperties {...props} />);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Clear due date"));

    // ONE call carrying only dueDate — the start date must NOT be touched.
    expect(props.onPatch).toHaveBeenCalledTimes(1);
    expect(props.onPatch).toHaveBeenCalledWith({ dueDate: null });
  });

  it("keeps both rows rendered after clearing one date", async () => {
    const props = makeProps({
      startDate: "2026-06-10T00:00:00.000Z",
      dueDate: "2026-06-20T00:00:00.000Z",
    });
    const { container, rerender } = render(<TaskDetailProperties {...props} />);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Clear due date"));

    // Simulate the parent applying the patch: due cleared, start kept. Both
    // rows must still be present (always-visible contract).
    rerender(
      <TaskDetailProperties
        {...props}
        task={makeTask({ startDate: "2026-06-10T00:00:00.000Z", dueDate: null })}
      />,
    );
    expect(getDateInputs(container)).toHaveLength(2);
    expect(screen.getByText("Start date")).toBeInTheDocument();
    expect(screen.getByText("Due date")).toBeInTheDocument();
    expect(screen.queryByText("+ Add start date")).toBeNull();
  });
});

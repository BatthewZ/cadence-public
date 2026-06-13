import { describe, expect, it } from "vitest";

import type { TaskLabelInfo } from "@/shared/schemas/label";

import type { TimelineTask } from "./grouping";
import {
  getDefaultOpenKeys,
  groupTasksByLabel,
  groupTimelineTasks,
  parseGroupingMode,
} from "./grouping";

/**
 * Tests for the label grouping mode of the Timeline.
 *
 * These pin down the D5 design contract: groups are derived from the labels
 * embedded on the tasks themselves (no separate label fetch), multi-label
 * tasks are intentionally duplicated into every matching group (the honest
 * representation of a many-to-many relation, matching the OR semantics of
 * the label filter), and the "No label" bucket (muted, icon meta
 * "unlabeled") always renders last. Without
 * these tests a well-meaning refactor could "deduplicate" tasks or reorder
 * the fallback group and silently change what users see on the timeline.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const bug: TaskLabelInfo = { id: "l-bug", name: "bug", color: "#ef4444" };
const feature: TaskLabelInfo = { id: "l-feat", name: "Feature", color: "#3b82f6" };
const urgent: TaskLabelInfo = { id: "l-urg", name: "URGENT", color: "#f59e0b" };

function makeTask(
  overrides: Partial<TimelineTask> & { id: string },
): TimelineTask {
  return {
    title: `Task ${overrides.id}`,
    completed: false,
    priority: "none",
    taskGroupId: "tg-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// groupTasksByLabel
// ---------------------------------------------------------------------------

describe("groupTasksByLabel", () => {
  it("returns an empty array for no tasks", () => {
    expect(groupTasksByLabel([])).toEqual([]);
  });

  it("places a multi-label task in every matching group (duplication is intentional)", () => {
    const tasks = [
      makeTask({ id: "t-1", labels: [bug, feature] }),
      makeTask({ id: "t-2", labels: [bug] }),
    ];

    const groups = groupTasksByLabel(tasks);

    expect(groups.map((g) => g.key)).toEqual(["l-bug", "l-feat"].map((id) => `label-${id}`));

    const bugGroup = groups.find((g) => g.key === "label-l-bug")!;
    const featGroup = groups.find((g) => g.key === "label-l-feat")!;

    // t-1 appears in both groups; each per-group count stays truthful even
    // though the counts sum to more than the number of distinct tasks.
    expect(bugGroup.tasks.map((t) => t.id)).toEqual(["t-1", "t-2"]);
    expect(featGroup.tasks.map((t) => t.id)).toEqual(["t-1"]);
  });

  it("sorts label groups by name case-insensitively", () => {
    // Insertion order is deliberately scrambled and mixes cases:
    // a case-sensitive sort would put "Feature" and "URGENT" before "bug".
    const tasks = [
      makeTask({ id: "t-1", labels: [urgent] }),
      makeTask({ id: "t-2", labels: [bug] }),
      makeTask({ id: "t-3", labels: [feature] }),
    ];

    const groups = groupTasksByLabel(tasks);

    expect(groups.map((g) => g.label)).toEqual(["bug", "Feature", "URGENT"]);
  });

  it("uses label-${id} keys and exposes the label color via meta", () => {
    const groups = groupTasksByLabel([makeTask({ id: "t-1", labels: [bug] })]);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("label-l-bug");
    expect(groups[0].meta?.color).toBe("#ef4444");
  });

  it("puts unlabeled tasks in a trailing 'No label' group with the unlabeled icon", () => {
    const tasks = [
      makeTask({ id: "t-1" }), // labels undefined
      makeTask({ id: "t-2", labels: [] }), // labels empty
      makeTask({ id: "t-3", labels: [urgent] }),
    ];

    const groups = groupTasksByLabel(tasks);

    expect(groups.map((g) => g.key)).toEqual(["label-l-urg", "label-none"]);
    const noLabel = groups[groups.length - 1];
    expect(noLabel.label).toBe("No label");
    expect(noLabel.meta?.icon).toBe("unlabeled");
    expect(noLabel.tasks.map((t) => t.id)).toEqual(["t-1", "t-2"]);
  });

  it("omits the 'No label' group when every task has a label", () => {
    const groups = groupTasksByLabel([makeTask({ id: "t-1", labels: [bug] })]);

    expect(groups.map((g) => g.key)).toEqual(["label-l-bug"]);
  });

  it("only creates groups for labels actually present on tasks (empty-group filtering)", () => {
    // Groups derive from embedded labels, so a label that exists in the
    // project but is attached to no visible task never produces a group —
    // equivalent to the empty-group filtering every other mode applies.
    const groups = groupTasksByLabel([
      makeTask({ id: "t-1", labels: [feature] }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Feature");
  });
});

// ---------------------------------------------------------------------------
// Dispatcher + URL parsing + default-open keys
// ---------------------------------------------------------------------------

describe("groupTimelineTasks (label mode)", () => {
  it("dispatches 'label' to groupTasksByLabel without needing taskGroups or members", () => {
    const tasks = [
      makeTask({ id: "t-1", labels: [bug] }),
      makeTask({ id: "t-2" }),
    ];

    const groups = groupTimelineTasks("label", tasks, [], []);

    expect(groups.map((g) => g.key)).toEqual(["label-l-bug", "label-none"]);
  });
});

describe("parseGroupingMode", () => {
  it("accepts 'label'", () => {
    expect(parseGroupingMode("label")).toBe("label");
  });

  it("falls back to 'dueDate' for null or unknown values", () => {
    expect(parseGroupingMode(null)).toBe("dueDate");
    expect(parseGroupingMode("labels")).toBe("dueDate");
  });
});

describe("getDefaultOpenKeys (label mode)", () => {
  it("opens all label groups by default (matching taskGroup/assignee behavior)", () => {
    const groups = groupTasksByLabel([
      makeTask({ id: "t-1", labels: [bug, feature] }),
      makeTask({ id: "t-2" }),
    ]);

    expect(getDefaultOpenKeys("label", groups)).toEqual([
      "label-l-bug",
      "label-l-feat",
      "label-none",
    ]);
  });
});

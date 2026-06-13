import { describe, expect, it } from "vitest";

import {
  type SavedViewState,
  TASK_VIEW_PARAM_KEYS,
} from "@/shared/schemas/saved-view";

import {
  captureViewState,
  clearViewSearch,
  isViewStateEqual,
  resolveViewTab,
  viewStateToSearch,
} from "./view-state";

/**
 * These tests pin the normalization contract that the Saved Views "dirty"
 * indicator depends on. A regression here does not throw — it silently shows
 * "Edited" on untouched views (false positive) or hides real edits (false
 * negative), neither of which any integration test of the ViewSwitcher would
 * reliably catch across every param combination. They are also, until the
 * ViewSwitcher wave lands, the only consumer of `view-state.ts`.
 */
describe("captureViewState", () => {
  it("captures every canonical view param present in the URL", () => {
    const params = new URLSearchParams({
      assignee: "u1,u2",
      priority: "high",
      completed: "true",
      dueDateFrom: "2026-06-01",
      dueDateTo: "2026-06-30",
      noDueDate: "true",
      label: "bug,none",
      groupBy: "assignee",
    });

    expect(captureViewState("board", params)).toEqual({
      tab: "board",
      params: {
        assignee: "u1,u2",
        priority: "high",
        completed: "true",
        dueDateFrom: "2026-06-01",
        dueDateTo: "2026-06-30",
        noDueDate: "true",
        label: "bug,none",
        groupBy: "assignee",
      },
    });
  });

  it("covers all TASK_VIEW_PARAM_KEYS (guards against a new key being added but untested)", () => {
    const params = new URLSearchParams(
      TASK_VIEW_PARAM_KEYS.map((key) => [key, `value-${key}`]),
    );
    const state = captureViewState("list", params);
    expect(Object.keys(state.params).sort()).toEqual([...TASK_VIEW_PARAM_KEYS].sort());
  });

  it("never captures the view param (a view must not point at a view)", () => {
    const params = new URLSearchParams({ view: "sv-1", priority: "low" });
    expect(captureViewState("board", params)).toEqual({
      tab: "board",
      params: { priority: "low" },
    });
  });

  it("never captures transient params like task (the open detail panel is not view state)", () => {
    const params = new URLSearchParams({ task: "task-9", assignee: "u1" });
    expect(captureViewState("board", params)).toEqual({
      tab: "board",
      params: { assignee: "u1" },
    });
  });

  it("ignores arbitrary non-canonical params (whitelist, not blacklist)", () => {
    const params = new URLSearchParams({ utm_source: "email", q: "search" });
    expect(captureViewState("timeline", params).params).toEqual({});
  });

  it("omits empty-string values (absent == empty)", () => {
    const params = new URLSearchParams({ assignee: "", priority: "high" });
    expect(captureViewState("board", params)).toEqual({
      tab: "board",
      params: { priority: "high" },
    });
  });

  it("preserves the tab exactly, including tabs this client does not know", () => {
    expect(captureViewState("calendar", new URLSearchParams()).tab).toBe("calendar");
  });
});

describe("viewStateToSearch", () => {
  it("serializes params plus view=<id>", () => {
    const search = viewStateToSearch(
      { tab: "board", params: { priority: "high" } },
      "sv-1",
    );
    const parsed = new URLSearchParams(search);
    expect(parsed.get("priority")).toBe("high");
    expect(parsed.get("view")).toBe("sv-1");
  });

  it("pins deterministic ordering: canonical keys in declared order, unknown keys sorted, view last", () => {
    const search = viewStateToSearch(
      {
        tab: "board",
        params: {
          // Deliberately scrambled insertion order.
          zeta: "z",
          groupBy: "assignee",
          assignee: "u1",
          alpha: "a",
          priority: "high",
        },
      },
      "sv-1",
    );
    expect(search).toBe(
      "assignee=u1&priority=high&groupBy=assignee&alpha=a&zeta=z&view=sv-1",
    );
  });

  it("is byte-stable for equal states regardless of param insertion order", () => {
    const a = viewStateToSearch(
      { tab: "board", params: { priority: "high", assignee: "u1" } },
      "sv-1",
    );
    const b = viewStateToSearch(
      { tab: "board", params: { assignee: "u1", priority: "high" } },
      "sv-1",
    );
    expect(a).toBe(b);
  });

  it("writes unknown stored keys verbatim (forward compatibility for future clients)", () => {
    const search = viewStateToSearch(
      { tab: "board", params: { sort: "dueDate:asc" } },
      "sv-1",
    );
    expect(new URLSearchParams(search).get("sort")).toBe("dueDate:asc");
  });

  it("round-trips through captureViewState, including unknown keys", () => {
    const state: SavedViewState = {
      tab: "list",
      params: {
        assignee: "u1,none",
        dueDateFrom: "2026-06-01",
        sort: "dueDate:asc", // unknown to this client
      },
    };
    const url = new URLSearchParams(viewStateToSearch(state, "sv-1"));

    // Canonical keys come back through capture...
    const recaptured = captureViewState("list", url);
    expect(recaptured.params.assignee).toBe("u1,none");
    expect(recaptured.params.dueDateFrom).toBe("2026-06-01");
    // ...the view id is on the URL but never recaptured into state...
    expect(url.get("view")).toBe("sv-1");
    expect(recaptured.params.view).toBeUndefined();
    // ...and the unknown key survived serialization verbatim.
    expect(url.get("sort")).toBe("dueDate:asc");
  });

  it("URL-encodes values safely (comma lists survive a parse round-trip)", () => {
    const search = viewStateToSearch(
      { tab: "board", params: { label: "bug,none", dueDateFrom: "2026-06-01" } },
      "sv 1",
    );
    const parsed = new URLSearchParams(search);
    expect(parsed.get("label")).toBe("bug,none");
    expect(parsed.get("view")).toBe("sv 1");
  });

  it("skips empty-string values (mirrors capture's absent == empty rule)", () => {
    const search = viewStateToSearch(
      { tab: "board", params: { assignee: "", priority: "high" } },
      "sv-1",
    );
    expect(search).toBe("priority=high&view=sv-1");
  });

  it("drops a stored view key so the applied id cannot be shadowed by a stale one", () => {
    const search = viewStateToSearch(
      { tab: "board", params: { view: "stale-id", priority: "high" } },
      "sv-1",
    );
    const parsed = new URLSearchParams(search);
    expect(parsed.getAll("view")).toEqual(["sv-1"]);
    expect(parsed.get("priority")).toBe("high");
  });

  it("emits only view=<id> for an empty params record", () => {
    expect(viewStateToSearch({ tab: "board", params: {} }, "sv-1")).toBe("view=sv-1");
  });
});

describe("clearViewSearch", () => {
  it("strips the view id and every canonical filter/grouping key", () => {
    const search = new URLSearchParams();
    search.set("view", "sv-1");
    for (const key of TASK_VIEW_PARAM_KEYS) search.set(key, `value-${key}`);

    expect(clearViewSearch(search)).toBe("");
  });

  it("preserves unrelated transient params (e.g. an open task panel)", () => {
    const search = new URLSearchParams("view=sv-1&priority=high&task=t-42");
    // The open task must survive — clearing a view should not close a task the
    // user is reading; only the view + its filters are dropped.
    expect(clearViewSearch(search)).toBe("task=t-42");
  });

  it("leaves unknown future-client keys untouched (whitelist semantics)", () => {
    // This client can't know `sort` belongs to the view's filter state, so it
    // is preserved rather than guessed-at and stripped.
    const search = new URLSearchParams("view=sv-1&assignee=u1&sort=created");
    expect(clearViewSearch(search)).toBe("sort=created");
  });

  it("returns an empty string when nothing but view state was present", () => {
    expect(clearViewSearch(new URLSearchParams("view=sv-1&label=l-1"))).toBe("");
  });

  it("does not mutate the input params", () => {
    const search = new URLSearchParams("view=sv-1&priority=high");
    clearViewSearch(search);
    expect(search.get("view")).toBe("sv-1");
    expect(search.get("priority")).toBe("high");
  });
});

describe("resolveViewTab", () => {
  it("passes known tabs through", () => {
    expect(resolveViewTab("board")).toBe("board");
    expect(resolveViewTab("list")).toBe("list");
    expect(resolveViewTab("timeline")).toBe("timeline");
  });

  it('falls back to "board" for tabs saved by a newer client', () => {
    expect(resolveViewTab("calendar")).toBe("board");
  });

  it('falls back to "board" for garbage input', () => {
    expect(resolveViewTab("")).toBe("board");
    expect(resolveViewTab("Board")).toBe("board"); // case-sensitive: not a known tab
    expect(resolveViewTab("settings")).toBe("board"); // a project tab, but not a view tab
  });
});

describe("isViewStateEqual", () => {
  const base = (overrides?: Partial<SavedViewState>): SavedViewState => ({
    tab: "board",
    params: { assignee: "u1,u2", dueDateFrom: "2026-06-01" },
    ...overrides,
  });

  it("is equal for identical states", () => {
    expect(isViewStateEqual(base(), base())).toBe(true);
  });

  it("ignores comma-list order for multi-value params (no false 'Edited')", () => {
    const a: SavedViewState = { tab: "board", params: { assignee: "u1,none" } };
    const b: SavedViewState = { tab: "board", params: { assignee: "none,u1" } };
    expect(isViewStateEqual(a, b)).toBe(true);
  });

  it("treats every MULTI_VALUE_PARAM_KEY as order-insensitive", () => {
    for (const key of ["assignee", "priority", "label"]) {
      const a: SavedViewState = { tab: "board", params: { [key]: "x,y" } };
      const b: SavedViewState = { tab: "board", params: { [key]: "y,x" } };
      expect(isViewStateEqual(a, b)).toBe(true);
    }
  });

  it("treats multi-value lists as sets (duplicates and stray commas are insignificant)", () => {
    const a: SavedViewState = { tab: "board", params: { priority: "high,high," } };
    const b: SavedViewState = { tab: "board", params: { priority: "high" } };
    expect(isViewStateEqual(a, b)).toBe(true);
  });

  it("ignores key order (records compare as maps)", () => {
    const a: SavedViewState = {
      tab: "board",
      params: { priority: "high", assignee: "u1" },
    };
    const b: SavedViewState = {
      tab: "board",
      params: { assignee: "u1", priority: "high" },
    };
    expect(isViewStateEqual(a, b)).toBe(true);
  });

  it("treats absent and empty-string values as the same state", () => {
    const a: SavedViewState = { tab: "board", params: { completed: "", assignee: "u1" } };
    const b: SavedViewState = { tab: "board", params: { assignee: "u1" } };
    expect(isViewStateEqual(a, b)).toBe(true);
    expect(isViewStateEqual(b, a)).toBe(true);
  });

  it("treats absent and empty as equal for unknown keys too", () => {
    const a: SavedViewState = { tab: "board", params: { sort: "" } };
    const b: SavedViewState = { tab: "board", params: {} };
    expect(isViewStateEqual(a, b)).toBe(true);
  });

  it("compares tab exactly", () => {
    expect(isViewStateEqual(base(), base({ tab: "list" }))).toBe(false);
  });

  it("detects a changed multi-value selection", () => {
    const a: SavedViewState = { tab: "board", params: { assignee: "u1" } };
    const b: SavedViewState = { tab: "board", params: { assignee: "u1,u2" } };
    expect(isViewStateEqual(a, b)).toBe(false);
  });

  it("is order-SENSITIVE for single-value params (a date change is a real edit)", () => {
    const a: SavedViewState = { tab: "board", params: { dueDateFrom: "2026-06-01" } };
    const b: SavedViewState = { tab: "board", params: { dueDateFrom: "2026-06-02" } };
    expect(isViewStateEqual(a, b)).toBe(false);
  });

  it("does not split single-value params on commas", () => {
    // dueDateFrom is not a multi-value key; "a,b" vs "b,a" must differ.
    const a: SavedViewState = { tab: "board", params: { dueDateFrom: "a,b" } };
    const b: SavedViewState = { tab: "board", params: { dueDateFrom: "b,a" } };
    expect(isViewStateEqual(a, b)).toBe(false);
  });

  it("detects differences in unknown keys (a future client's edit still reads as 'Edited')", () => {
    const a: SavedViewState = { tab: "board", params: { sort: "dueDate:asc" } };
    const b: SavedViewState = { tab: "board", params: { sort: "dueDate:desc" } };
    expect(isViewStateEqual(a, b)).toBe(false);
  });

  it("compares unknown keys verbatim, not as comma sets", () => {
    const a: SavedViewState = { tab: "board", params: { sort: "a,b" } };
    const b: SavedViewState = { tab: "board", params: { sort: "b,a" } };
    expect(isViewStateEqual(a, b)).toBe(false);
  });

  it("detects an unknown key present on only one side", () => {
    const a: SavedViewState = { tab: "board", params: { sort: "dueDate:asc" } };
    const b: SavedViewState = { tab: "board", params: {} };
    expect(isViewStateEqual(a, b)).toBe(false);
    expect(isViewStateEqual(b, a)).toBe(false);
  });

  it("dirty-checks a real apply-then-edit flow end to end", () => {
    // User applies a view, URL now carries its params + view id.
    const stored: SavedViewState = {
      tab: "board",
      params: { assignee: "u1,u2", priority: "high" },
    };
    const url = new URLSearchParams(viewStateToSearch(stored, "sv-1"));

    // Untouched URL: not dirty, even though the URL also carries view=sv-1.
    expect(isViewStateEqual(captureViewState("board", url), stored)).toBe(true);

    // User toggles an assignee off and back on — URL value reordered only.
    url.set("assignee", "u2,u1");
    expect(isViewStateEqual(captureViewState("board", url), stored)).toBe(true);

    // User actually changes a filter: dirty.
    url.set("priority", "low");
    expect(isViewStateEqual(captureViewState("board", url), stored)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  createSavedViewSchema,
  MULTI_VALUE_PARAM_KEYS,
  SAVED_VIEW_MAX_PARAM_LENGTH,
  SAVED_VIEW_MAX_PARAMS,
  savedViewStateSchema,
  TASK_FILTER_PARAM_KEYS,
  TASK_VIEW_PARAM_KEYS,
  updateSavedViewSchema,
} from "./saved-view";

/**
 * Saved-view payloads cross a trust AND a version boundary: they are written
 * by whatever client version created them and re-served to whatever client
 * version reads them later. These tests pin the two halves of that contract:
 *
 * 1. OPENNESS — unknown param keys and unknown tab names must be ACCEPTED and
 *    preserved verbatim. That is the feature, not an oversight: a future
 *    client that knows a `calendar` tab or a `sort` param stores its view
 *    state through today's server, and stripping/rejecting it would silently
 *    corrupt those views. The schema therefore must never become a closed
 *    key enum.
 * 2. BOUNDS — because keys are open, the only defense against abuse is size:
 *    entry count, key length, value length, name length, tab length. These
 *    are what keep an open record from becoming an unbounded blob store.
 */

const VALID_STATE = {
  tab: "board",
  params: { assignee: "u1,none", priority: "high,urgent" },
};

describe("savedViewStateSchema params (forward-compat openness)", () => {
  it("accepts unknown param keys and preserves them verbatim", () => {
    const result = savedViewStateSchema.safeParse({
      tab: "board",
      params: { sort: "dueDate:asc", swimlane: "assignee", assignee: "u1" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Round-trip fidelity: the unknown keys come back exactly as stored.
      expect(result.data.params).toEqual({
        sort: "dueDate:asc",
        swimlane: "assignee",
        assignee: "u1",
      });
    }
  });

  it("accepts an empty params record (a view can snapshot just a tab)", () => {
    expect(savedViewStateSchema.safeParse({ tab: "list", params: {} }).success).toBe(true);
  });

  it(`accepts exactly ${SAVED_VIEW_MAX_PARAMS} params and rejects one more`, () => {
    const atCap = Object.fromEntries(
      Array.from({ length: SAVED_VIEW_MAX_PARAMS }, (_, i) => [`k${i}`, "v"]),
    );
    expect(savedViewStateSchema.safeParse({ tab: "board", params: atCap }).success).toBe(true);

    const overCap = { ...atCap, extra: "v" };
    expect(savedViewStateSchema.safeParse({ tab: "board", params: overCap }).success).toBe(false);
  });

  it(`accepts a ${SAVED_VIEW_MAX_PARAM_LENGTH}-char value and rejects an oversized one`, () => {
    const atCap = "x".repeat(SAVED_VIEW_MAX_PARAM_LENGTH);
    expect(
      savedViewStateSchema.safeParse({ tab: "board", params: { assignee: atCap } }).success,
    ).toBe(true);
    expect(
      savedViewStateSchema.safeParse({ tab: "board", params: { assignee: `${atCap}x` } }).success,
    ).toBe(false);
  });

  it("accepts a 40-char key and rejects oversized or empty keys", () => {
    expect(
      savedViewStateSchema.safeParse({ tab: "board", params: { ["k".repeat(40)]: "v" } }).success,
    ).toBe(true);
    expect(
      savedViewStateSchema.safeParse({ tab: "board", params: { ["k".repeat(41)]: "v" } }).success,
    ).toBe(false);
    expect(
      savedViewStateSchema.safeParse({ tab: "board", params: { "": "v" } }).success,
    ).toBe(false);
  });

  it("rejects non-string param values (URL params are strings by definition)", () => {
    expect(
      savedViewStateSchema.safeParse({ tab: "board", params: { assignee: 7 } }).success,
    ).toBe(false);
  });
});

describe("savedViewStateSchema tab", () => {
  it("accepts tab strings this deployment has never heard of", () => {
    // The web client falls back to "board" for unknown tabs; the SERVER must
    // not reject them, or future clients' views would fail to save.
    expect(savedViewStateSchema.safeParse({ tab: "calendar", params: {} }).success).toBe(true);
  });

  it("rejects an empty tab and an over-long tab", () => {
    expect(savedViewStateSchema.safeParse({ tab: "", params: {} }).success).toBe(false);
    expect(savedViewStateSchema.safeParse({ tab: "x".repeat(21), params: {} }).success).toBe(false);
  });
});

describe("createSavedViewSchema name (trim-then-validate semantics)", () => {
  it("trims surrounding whitespace and validates length on the TRIMMED value", () => {
    // Pinned semantics: `.trim()` precedes `.min(1).max(50)`, so " x " is a
    // valid 1-char name and the stored value is the trimmed "x". The reverse
    // order (validate-then-trim) would let a whitespace-only name through as
    // "" — which the next test guards against.
    const result = createSavedViewSchema.safeParse({ name: " x ", state: VALID_STATE });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("x");
  });

  it("rejects a whitespace-only name (would otherwise store an empty name)", () => {
    expect(createSavedViewSchema.safeParse({ name: "   ", state: VALID_STATE }).success).toBe(
      false,
    );
  });

  it("rejects an empty name and a name over 50 trimmed chars", () => {
    expect(createSavedViewSchema.safeParse({ name: "", state: VALID_STATE }).success).toBe(false);
    expect(
      createSavedViewSchema.safeParse({ name: "n".repeat(51), state: VALID_STATE }).success,
    ).toBe(false);
  });

  it("accepts a 50-char name even when padded with whitespace", () => {
    const result = createSavedViewSchema.safeParse({
      name: `  ${"n".repeat(50)}  `,
      state: VALID_STATE,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("n".repeat(50));
  });
});

describe("updateSavedViewSchema", () => {
  it("accepts an empty patch (both fields optional)", () => {
    expect(updateSavedViewSchema.safeParse({}).success).toBe(true);
  });

  it("applies the same name and state rules as create when fields are present", () => {
    expect(updateSavedViewSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(updateSavedViewSchema.safeParse({ state: { tab: "", params: {} } }).success).toBe(
      false,
    );
    const result = updateSavedViewSchema.safeParse({ name: " renamed " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("renamed");
  });
});

describe("view param key constants", () => {
  // This pins the exact key list. The companion contract — that these are the
  // params use-task-filters actually reads/writes — is enforced structurally:
  // the hook imports TASK_FILTER_PARAM_KEYS as its only param list (no local
  // copy to drift), and its own 22-test suite
  // (src/web/hooks/use-task-filters.test.tsx) exercises every member through
  // real URL round-trips. We deliberately do NOT import the hook here: that
  // would pull react/react-router into the node-environment `unit` project.
  it("TASK_FILTER_PARAM_KEYS is the canonical filter-bar param list", () => {
    expect(TASK_FILTER_PARAM_KEYS).toEqual([
      "assignee",
      "priority",
      "completed",
      "dueDateFrom",
      "dueDateTo",
      "noDueDate",
      "label",
    ]);
  });

  it("TASK_VIEW_PARAM_KEYS is the filter keys plus groupBy", () => {
    expect(TASK_VIEW_PARAM_KEYS).toEqual([...TASK_FILTER_PARAM_KEYS, "groupBy"]);
  });

  it("MULTI_VALUE_PARAM_KEYS is a subset of TASK_FILTER_PARAM_KEYS", () => {
    for (const key of MULTI_VALUE_PARAM_KEYS) {
      expect(TASK_FILTER_PARAM_KEYS).toContain(key);
    }
  });
});

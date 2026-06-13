import { describe, expect, it } from "vitest";

import {
  createTaskSchema,
  listActivityQuerySchema,
  recurrenceRuleSchema,
  updateTaskSchema,
} from "./task";

/**
 * Regression tests for the shape-only-date-validation bug class: `dueDate`
 * flows into `new Date(body.dueDate)` and the DB timestamp column, and
 * `recurrenceRule.endDate` flows into `Date.UTC(y, m - 1, d)` arithmetic in
 * computeNextDueDate. Shape-valid but calendar-impossible inputs either roll
 * forward silently (`2030-02-30` → `2030-03-02`: plausible-but-wrong stored
 * data / a recurrence series ending on the wrong day) or become `NaN`
 * (`2030-13-45`: corrupt SQL binding / a series that never terminates).
 * These tests pin the boundary so the bug cannot reappear.
 */

const VALID_CREATE = {
  title: "A task",
  taskGroupId: "5f0c3a3e-9d2b-4c8a-b1f0-2a6f1f3d4e5a",
};

describe("createTaskSchema dueDate", () => {
  it("accepts a valid YYYY-MM-DD calendar date", () => {
    expect(
      createTaskSchema.safeParse({ ...VALID_CREATE, dueDate: "2030-03-15" }).success,
    ).toBe(true);
  });

  it("accepts a leap-day date in a leap year", () => {
    expect(
      createTaskSchema.safeParse({ ...VALID_CREATE, dueDate: "2024-02-29" }).success,
    ).toBe(true);
  });

  it("accepts a full ISO 8601 datetime (documented API format)", () => {
    expect(
      createTaskSchema.safeParse({
        ...VALID_CREATE,
        dueDate: "2030-03-15T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("accepts an ISO datetime with a timezone offset", () => {
    expect(
      createTaskSchema.safeParse({
        ...VALID_CREATE,
        dueDate: "2030-03-15T10:30:00+05:30",
      }).success,
    ).toBe(true);
  });

  it("accepts null and omitted dueDate", () => {
    expect(createTaskSchema.safeParse({ ...VALID_CREATE, dueDate: null }).success).toBe(true);
    expect(createTaskSchema.safeParse(VALID_CREATE).success).toBe(true);
  });

  it("rejects calendar-impossible dates that new Date() would roll forward", () => {
    // new Date("2030-02-30") rolls to Mar 2 — must be rejected, not stored wrong
    for (const bad of ["2030-02-30", "2023-02-29", "2030-04-31", "2030-02-30T00:00:00.000Z"]) {
      expect(createTaskSchema.safeParse({ ...VALID_CREATE, dueDate: bad }).success).toBe(false);
    }
  });

  it("rejects shape-invalid and NaN-producing strings", () => {
    // new Date("2030-13-45") is Invalid Date → NaN bound into the timestamp column
    for (const bad of ["2030-13-45", "garbage", "30-02-2030", "2030/02/15", ""]) {
      expect(createTaskSchema.safeParse({ ...VALID_CREATE, dueDate: bad }).success).toBe(false);
    }
  });
});

describe("updateTaskSchema dueDate", () => {
  it("accepts a valid calendar date, datetime, and null", () => {
    expect(updateTaskSchema.safeParse({ dueDate: "2030-03-15" }).success).toBe(true);
    expect(updateTaskSchema.safeParse({ dueDate: "2030-03-15T00:00:00.000Z" }).success).toBe(true);
    expect(updateTaskSchema.safeParse({ dueDate: null }).success).toBe(true);
  });

  it("rejects calendar-impossible and malformed dates", () => {
    for (const bad of ["2030-02-30", "2030-13-45", "garbage", ""]) {
      expect(updateTaskSchema.safeParse({ dueDate: bad }).success).toBe(false);
    }
  });
});

describe("recurrenceRuleSchema endDate", () => {
  const VALID_RULE = { frequency: "daily", interval: 1 } as const;

  it("accepts a valid YYYY-MM-DD end date and an omitted one", () => {
    expect(
      recurrenceRuleSchema.safeParse({ ...VALID_RULE, endDate: "2030-03-15" }).success,
    ).toBe(true);
    expect(recurrenceRuleSchema.safeParse(VALID_RULE).success).toBe(true);
  });

  it("rejects calendar-impossible end dates (would roll forward in Date.UTC)", () => {
    for (const bad of ["2030-02-30", "2023-02-29", "2030-04-31"]) {
      expect(recurrenceRuleSchema.safeParse({ ...VALID_RULE, endDate: bad }).success).toBe(false);
    }
  });

  it("rejects non-date strings (would make the end bound NaN → series never ends)", () => {
    for (const bad of ["2030-13-45", "garbage", "2030-03-15T00:00:00.000Z", ""]) {
      expect(recurrenceRuleSchema.safeParse({ ...VALID_RULE, endDate: bad }).success).toBe(false);
    }
  });
});

describe("listActivityQuerySchema", () => {
  it("accepts empty query (all optional)", () => {
    const result = listActivityQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(5);
      expect(result.data.cursor).toBeUndefined();
    }
  });

  it("accepts valid limit as string", () => {
    const result = listActivityQuerySchema.safeParse({ limit: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });

  it("accepts valid cursor", () => {
    const result = listActivityQuerySchema.safeParse({ cursor: "2025-01-01T00:00:00.000Z" });
    expect(result.success).toBe(true);
  });

  it("rejects limit below minimum", () => {
    const result = listActivityQuerySchema.safeParse({ limit: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects limit above maximum", () => {
    const result = listActivityQuerySchema.safeParse({ limit: "101" });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric limit", () => {
    const result = listActivityQuerySchema.safeParse({ limit: "abc" });
    expect(result.success).toBe(false);
  });

  it("rejects negative limit", () => {
    const result = listActivityQuerySchema.safeParse({ limit: "-5" });
    expect(result.success).toBe(false);
  });

  it("accepts max limit boundary", () => {
    const result = listActivityQuerySchema.safeParse({ limit: "100" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(100);
    }
  });

  it("accepts min limit boundary", () => {
    const result = listActivityQuerySchema.safeParse({ limit: "1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(1);
    }
  });
});

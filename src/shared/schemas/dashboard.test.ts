import { describe, expect, it } from "vitest";

import { myTasksQuerySchema, upcomingTasksQuerySchema } from "./dashboard";

describe("myTasksQuerySchema", () => {
  it("accepts empty query (all optional)", () => {
    const result = myTasksQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.cursor).toBeUndefined();
      expect(result.data.period).toBeUndefined();
    }
  });

  it("accepts valid limit as string", () => {
    const result = myTasksQuerySchema.safeParse({ limit: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });

  it("accepts valid cursor", () => {
    const result = myTasksQuerySchema.safeParse({ cursor: "2025-01-01T00:00:00.000Z" });
    expect(result.success).toBe(true);
  });

  it("accepts valid period values", () => {
    for (const period of ["week", "fortnight", "month"]) {
      const result = myTasksQuerySchema.safeParse({ period });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.period).toBe(period);
      }
    }
  });

  it("rejects invalid period value", () => {
    const result = myTasksQuerySchema.safeParse({ period: "year" });
    expect(result.success).toBe(false);
  });

  it("rejects limit below minimum", () => {
    const result = myTasksQuerySchema.safeParse({ limit: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects limit above maximum", () => {
    const result = myTasksQuerySchema.safeParse({ limit: "201" });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric limit", () => {
    const result = myTasksQuerySchema.safeParse({ limit: "abc" });
    expect(result.success).toBe(false);
  });

  it("rejects negative limit", () => {
    const result = myTasksQuerySchema.safeParse({ limit: "-1" });
    expect(result.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Filter params (priority, due dates, labels)
  //
  // These params drive server-side SQL filtering on a cursor-paginated
  // endpoint, so the schema is the only line of defense between raw query
  // strings and the IN (...) / date-boundary clauses the handler builds.
  // -------------------------------------------------------------------------

  it("defaults filter params when absent", () => {
    const result = myTasksQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toEqual([]);
      expect(result.data.labelNames).toEqual([]);
      expect(result.data.dueDateFrom).toBeUndefined();
      expect(result.data.dueDateTo).toBeUndefined();
      expect(result.data.noDueDate).toBe(false);
      expect(result.data.noLabel).toBe(false);
    }
  });

  it("parses a valid priority CSV (trimming entries)", () => {
    const result = myTasksQuerySchema.safeParse({ priority: "urgent, high ,none" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toEqual(["urgent", "high", "none"]);
    }
  });

  it("accepts every TaskPriority value", () => {
    const result = myTasksQuerySchema.safeParse({ priority: "urgent,high,medium,low,none" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toEqual(["urgent", "high", "medium", "low", "none"]);
    }
  });

  it("rejects an invalid priority value in the CSV", () => {
    const result = myTasksQuerySchema.safeParse({ priority: "urgent,banana" });
    expect(result.success).toBe(false);
  });

  it("accepts valid YYYY-MM-DD due date bounds", () => {
    const result = myTasksQuerySchema.safeParse({
      dueDateFrom: "2030-03-15",
      dueDateTo: "2030-03-16",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dueDateFrom).toBe("2030-03-15");
      expect(result.data.dueDateTo).toBe("2030-03-16");
    }
  });

  it("rejects malformed due date formats", () => {
    const badDates = ["2030/03/15", "15-03-2030", "2030-3-5", "2030-03-15T00:00:00Z", "not-a-date"];
    for (const bad of badDates) {
      expect(myTasksQuerySchema.safeParse({ dueDateFrom: bad }).success).toBe(false);
      expect(myTasksQuerySchema.safeParse({ dueDateTo: bad }).success).toBe(false);
    }
  });

  it("rejects calendar-impossible dates that pass a shape check", () => {
    // These match `\d{4}-\d{2}-\d{2}` but are not real days. A bare regex would
    // wave them through, then `new Date()` would silently roll them forward
    // ("2030-02-30" → "2030-03-02", wrong rows) or yield Invalid Date → NaN
    // when bound to the timestamp column. Calendar-aware validation rejects
    // them at the boundary.
    const impossible = ["2030-02-30", "2030-13-45", "2030-00-10", "2023-02-29"];
    for (const bad of impossible) {
      expect(myTasksQuerySchema.safeParse({ dueDateFrom: bad }).success).toBe(false);
      expect(myTasksQuerySchema.safeParse({ dueDateTo: bad }).success).toBe(false);
    }
    // Leap day in an actual leap year is a real date and must still pass.
    expect(myTasksQuerySchema.safeParse({ dueDateFrom: "2024-02-29" }).success).toBe(true);
  });

  it("transforms noDueDate/noLabel 'true' into booleans", () => {
    const result = myTasksQuerySchema.safeParse({ noDueDate: "true", noLabel: "true" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.noDueDate).toBe(true);
      expect(result.data.noLabel).toBe(true);
    }
  });

  it("rejects noDueDate/noLabel values other than 'true'", () => {
    for (const bad of ["false", "1", "yes"]) {
      expect(myTasksQuerySchema.safeParse({ noDueDate: bad }).success).toBe(false);
      expect(myTasksQuerySchema.safeParse({ noLabel: bad }).success).toBe(false);
    }
  });

  it("parses labelNames CSV, trimming entries and dropping empty segments", () => {
    const result = myTasksQuerySchema.safeParse({ labelNames: "Bug, Frontend,,none," });
    expect(result.success).toBe(true);
    if (result.success) {
      // "none" is a legal label *name* here — absence-of-label is the
      // separate noLabel flag, never a sentinel inside labelNames.
      expect(result.data.labelNames).toEqual(["Bug", "Frontend", "none"]);
    }
  });

  it("accepts label names up to 30 chars and rejects longer", () => {
    expect(myTasksQuerySchema.safeParse({ labelNames: "a".repeat(30) }).success).toBe(true);
    expect(myTasksQuerySchema.safeParse({ labelNames: "a".repeat(31) }).success).toBe(false);
  });

  it("accepts up to 50 label names and rejects 51", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `label-${i}`).join(",");
    const fiftyOne = Array.from({ length: 51 }, (_, i) => `label-${i}`).join(",");
    expect(myTasksQuerySchema.safeParse({ labelNames: fifty }).success).toBe(true);
    expect(myTasksQuerySchema.safeParse({ labelNames: fiftyOne }).success).toBe(false);
  });
});

describe("upcomingTasksQuerySchema", () => {
  it("accepts empty query (all optional)", () => {
    const result = upcomingTasksQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.cursor).toBeUndefined();
    }
  });

  it("accepts valid limit as string", () => {
    const result = upcomingTasksQuerySchema.safeParse({ limit: "25" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });

  it("accepts valid cursor", () => {
    const result = upcomingTasksQuerySchema.safeParse({ cursor: "2025-06-15T12:00:00.000Z" });
    expect(result.success).toBe(true);
  });

  it("rejects limit below minimum", () => {
    const result = upcomingTasksQuerySchema.safeParse({ limit: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects limit above maximum", () => {
    const result = upcomingTasksQuerySchema.safeParse({ limit: "201" });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric limit", () => {
    const result = upcomingTasksQuerySchema.safeParse({ limit: "abc" });
    expect(result.success).toBe(false);
  });
});

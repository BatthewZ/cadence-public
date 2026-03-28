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

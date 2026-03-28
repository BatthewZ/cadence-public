import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { computeCompoundNextCursor, computeNextCursor, parseCompoundCursor, parseCursorDate, parseCursorParams } from "./pagination";

/**
 * Tests for the shared cursor-based pagination utility library.
 * These functions are critical shared infrastructure used by comments,
 * activity, and dashboard endpoints — regressions here silently break
 * pagination across the entire app.
 */

// Helper: spin up a tiny Hono app so we get a real Context with query params
function createPaginationApp(opts: { defaultLimit: number; maxLimit: number }) {
  const app = new Hono();
  app.get("/test", (c) => {
    const result = parseCursorParams(c, opts);
    return c.json(result);
  });
  return app;
}

async function fetchParams(
  qs: string,
  opts: { defaultLimit: number; maxLimit: number } = { defaultLimit: 20, maxLimit: 100 },
) {
  const app = createPaginationApp(opts);
  const res = await app.request(`/test${qs ? `?${qs}` : ""}`);
  return res.json();
}

describe("parseCursorParams", () => {
  it("returns default limit when no query params provided", async () => {
    const result = (await fetchParams("")) as { limit: number; cursor: string | undefined };
    expect(result.limit).toBe(20);
    expect(result.cursor).toBeUndefined();
  });

  it("parses valid limit from query string", async () => {
    const result = (await fetchParams("limit=10")) as { limit: number };
    expect(result.limit).toBe(10);
  });

  it("clamps limit to maxLimit when exceeding max", async () => {
    const result = (await fetchParams("limit=200", { defaultLimit: 20, maxLimit: 100 })) as { limit: number };
    expect(result.limit).toBe(100);
  });

  it("falls back to defaultLimit when limit is zero (falsy parseInt result)", async () => {
    // parseInt("0") === 0 which is falsy, so `0 || defaultLimit` yields defaultLimit
    const result = (await fetchParams("limit=0")) as { limit: number };
    expect(result.limit).toBe(20);
  });

  it("clamps limit to 1 when negative", async () => {
    const result = (await fetchParams("limit=-5")) as { limit: number };
    expect(result.limit).toBe(1);
  });

  it("falls back to defaultLimit when limit is non-numeric", async () => {
    const result = (await fetchParams("limit=abc", { defaultLimit: 15, maxLimit: 100 })) as { limit: number };
    expect(result.limit).toBe(15);
  });

  it("returns cursor as string when provided", async () => {
    const result = (await fetchParams("cursor=2025-01-01T00:00:00.000Z")) as { cursor: string };
    expect(result.cursor).toBe("2025-01-01T00:00:00.000Z");
  });

  it("returns cursor as undefined when absent", async () => {
    const result = (await fetchParams("limit=10")) as { cursor: string | undefined };
    expect(result.cursor).toBeUndefined();
  });

  it("returns cursor as undefined when empty string", async () => {
    const result = (await fetchParams("cursor=")) as { cursor: string | undefined };
    expect(result.cursor).toBeUndefined();
  });
});

describe("parseCursorDate", () => {
  it("returns null for undefined input", () => {
    expect(parseCursorDate(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCursorDate("")).toBeNull();
  });

  it("returns null for invalid date string", () => {
    expect(parseCursorDate("not-a-date")).toBeNull();
  });

  it("returns valid Date for ISO timestamp string", () => {
    const result = parseCursorDate("2025-01-15T10:30:00.000Z");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2025-01-15T10:30:00.000Z");
  });

  it("returns valid Date for date-only string", () => {
    const result = parseCursorDate("2025-01-01");
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2025);
  });

  it("returns null for 'Invalid Date' edge cases", () => {
    expect(parseCursorDate("9999-99-99")).toBeNull();
  });
});

describe("computeNextCursor", () => {
  it("returns null when items.length < limit (no more pages)", () => {
    const items = [{ createdAt: new Date("2025-01-01") }];
    const result = computeNextCursor(items, 10, (i) => i.createdAt);
    expect(result).toBeNull();
  });

  it("returns ISO string when items.length === limit and getDate returns Date", () => {
    const date = new Date("2025-06-15T12:00:00.000Z");
    const items = [
      { createdAt: new Date("2025-06-14T12:00:00.000Z") },
      { createdAt: date },
    ];
    const result = computeNextCursor(items, 2, (i) => i.createdAt);
    expect(result).toBe("2025-06-15T12:00:00.000Z");
  });

  it("returns string directly when items.length === limit and getDate returns string", () => {
    const items = [
      { cursor: "2025-01-01T00:00:00.000Z" },
      { cursor: "2025-01-02T00:00:00.000Z" },
    ];
    const result = computeNextCursor(items, 2, (i) => i.cursor);
    expect(result).toBe("2025-01-02T00:00:00.000Z");
  });

  it("returns null for empty items array", () => {
    const result = computeNextCursor([], 10, () => new Date());
    expect(result).toBeNull();
  });

  it("correctly reads the last item's date (not first or middle)", () => {
    const items = [
      { date: new Date("2025-01-01T00:00:00.000Z") },
      { date: new Date("2025-02-01T00:00:00.000Z") },
      { date: new Date("2025-03-01T00:00:00.000Z") },
    ];
    const result = computeNextCursor(items, 3, (i) => i.date);
    expect(result).toBe("2025-03-01T00:00:00.000Z");
  });

  it("handles limit of 1 with exactly 1 item", () => {
    const items = [{ ts: new Date("2025-12-31T23:59:59.999Z") }];
    const result = computeNextCursor(items, 1, (i) => i.ts);
    expect(result).toBe("2025-12-31T23:59:59.999Z");
  });
});

/**
 * Compound cursor utilities ensure deterministic pagination when the primary
 * sort column has duplicate values. Without them, rows sharing the same date
 * can be skipped or duplicated across pages.
 */

describe("parseCompoundCursor", () => {
  it("returns null for undefined input", () => {
    expect(parseCompoundCursor(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCompoundCursor("")).toBeNull();
  });

  it("parses valid compound cursor (date|id)", () => {
    const result = parseCompoundCursor("2025-06-15T12:00:00.000Z|abc-123");
    expect(result).not.toBeNull();
    expect(result!.date.toISOString()).toBe("2025-06-15T12:00:00.000Z");
    expect(result!.id).toBe("abc-123");
  });

  it("falls back to date-only with empty id for simple date cursor (backward compat)", () => {
    const result = parseCompoundCursor("2025-01-01T00:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result!.date.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(result!.id).toBe("");
  });

  it("returns null for invalid date in compound cursor", () => {
    expect(parseCompoundCursor("not-a-date|abc")).toBeNull();
  });

  it("returns null when id part is empty after pipe", () => {
    expect(parseCompoundCursor("2025-01-01T00:00:00.000Z|")).toBeNull();
  });

  it("returns null for completely invalid string without pipe", () => {
    expect(parseCompoundCursor("garbage")).toBeNull();
  });

  it("handles id containing special characters", () => {
    const result = parseCompoundCursor("2025-03-01T00:00:00.000Z|uuid-with-dashes-123");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("uuid-with-dashes-123");
  });
});

describe("computeCompoundNextCursor", () => {
  it("returns null when items.length < limit (no more pages)", () => {
    const items = [{ createdAt: new Date("2025-01-01"), id: "a" }];
    const result = computeCompoundNextCursor(items, 10, (i) => i.createdAt, (i) => i.id);
    expect(result).toBeNull();
  });

  it("returns compound cursor when items.length === limit", () => {
    const items = [
      { createdAt: new Date("2025-06-14T12:00:00.000Z"), id: "task-1" },
      { createdAt: new Date("2025-06-15T12:00:00.000Z"), id: "task-2" },
    ];
    const result = computeCompoundNextCursor(items, 2, (i) => i.createdAt, (i) => i.id);
    expect(result).toBe("2025-06-15T12:00:00.000Z|task-2");
  });

  it("uses last item's date and id (not first or middle)", () => {
    const items = [
      { date: "2025-01-01T00:00:00.000Z", id: "a" },
      { date: "2025-02-01T00:00:00.000Z", id: "b" },
      { date: "2025-03-01T00:00:00.000Z", id: "c" },
    ];
    const result = computeCompoundNextCursor(items, 3, (i) => i.date, (i) => i.id);
    expect(result).toBe("2025-03-01T00:00:00.000Z|c");
  });

  it("returns null for empty items array", () => {
    const result = computeCompoundNextCursor([], 10, () => new Date(), () => "x");
    expect(result).toBeNull();
  });

  it("handles limit of 1 with exactly 1 item", () => {
    const items = [{ ts: new Date("2025-12-31T23:59:59.999Z"), id: "only" }];
    const result = computeCompoundNextCursor(items, 1, (i) => i.ts, (i) => i.id);
    expect(result).toBe("2025-12-31T23:59:59.999Z|only");
  });

  it("round-trips through parseCompoundCursor", () => {
    const items = [
      { date: new Date("2025-06-15T00:00:00.000Z"), id: "task-42" },
    ];
    const cursor = computeCompoundNextCursor(items, 1, (i) => i.date, (i) => i.id);
    expect(cursor).not.toBeNull();
    const parsed = parseCompoundCursor(cursor!);
    expect(parsed).not.toBeNull();
    expect(parsed!.date.toISOString()).toBe("2025-06-15T00:00:00.000Z");
    expect(parsed!.id).toBe("task-42");
  });
});

import { describe, expect, it } from "vitest";

import { listActivityQuerySchema } from "./task";

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

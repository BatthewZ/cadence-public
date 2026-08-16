import { describe, expect, it, vi } from "vitest";

import {
  isUniqueConstraintViolation,
  retryOnPositionConflict,
} from "./position-conflict";

/**
 * Unit tests for the UNIQUE-constraint predicate and the retry helper built on
 * it.
 *
 * `isUniqueConstraintViolation` is deliberately NOT position-specific — the
 * cases below use `foo` and `task.title` alongside the fractional-index columns
 * for exactly that reason. Every "insert and let the unique index arbitrate the
 * race" site in the API needs this one predicate, and the site that hand-rolled
 * its own (`spawnNextRecurringInstance`) got it wrong by testing only the outer
 * `.message`, which is why the cause-chain walk is pinned here rather than
 * trusted.
 *
 * `retryOnPositionConflict` is the position-specific consumer. Regressions in
 * it would either (a) swallow real non-UNIQUE errors by retrying them, or
 * (b) fail to retry genuine UNIQUE races and surface spurious 500s on
 * column/task/subtask creation.
 */

describe("isUniqueConstraintViolation", () => {
  it("matches D1's UNIQUE constraint error message", () => {
    const err = new Error(
      "D1_ERROR: UNIQUE constraint failed: task_group.projectId, task_group.position",
    );
    expect(isUniqueConstraintViolation(err)).toBe(true);
  });

  it("matches the bare SQLite phrasing without the D1_ERROR prefix", () => {
    expect(
      isUniqueConstraintViolation(new Error("UNIQUE constraint failed: task.position")),
    ).toBe(true);
  });

  it("is case-insensitive so it tolerates future driver changes", () => {
    expect(
      isUniqueConstraintViolation(new Error("unique constraint failed: foo")),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isUniqueConstraintViolation(new Error("NOT NULL constraint failed"))).toBe(false);
    expect(isUniqueConstraintViolation(new Error("database is locked"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isUniqueConstraintViolation(null)).toBe(false);
    expect(isUniqueConstraintViolation(undefined)).toBe(false);
    expect(isUniqueConstraintViolation("UNIQUE constraint failed")).toBe(false);
    expect(isUniqueConstraintViolation({ message: "UNIQUE constraint failed" })).toBe(false);
  });

  it("walks the cause chain to find a wrapped UNIQUE error", () => {
    // Mimics Drizzle's DrizzleQueryError shape: outer message describes
    // the query, cause carries the real SQLite error text. Without cause
    // traversal the helper would miss every production INSERT conflict.
    const inner = new Error("UNIQUE constraint failed: task_group.position");
    const wrapper = new Error("Failed query: insert into task_group...", { cause: inner });
    expect(isUniqueConstraintViolation(wrapper)).toBe(true);
  });

  it("walks multiple levels of cause chain", () => {
    const innermost = new Error("UNIQUE constraint failed: subtask.position");
    const middle = new Error("D1_ERROR", { cause: innermost });
    const outer = new Error("DrizzleQueryError", { cause: middle });
    expect(isUniqueConstraintViolation(outer)).toBe(true);
  });

  it("does not false-positive on a non-UNIQUE error wrapped in DrizzleQueryError", () => {
    const inner = new Error("NOT NULL constraint failed: task.title");
    const wrapper = new Error("Failed query: insert into task...", { cause: inner });
    expect(isUniqueConstraintViolation(wrapper)).toBe(false);
  });
});

describe("retryOnPositionConflict", () => {
  it("returns the value on the first successful attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryOnPositionConflict(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on UNIQUE violation and returns the value from the winning attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("UNIQUE constraint failed: task_group.position"))
      .mockRejectedValueOnce(new Error("UNIQUE constraint failed: task_group.position"))
      .mockResolvedValueOnce("finally-ok");
    const result = await retryOnPositionConflict(fn, 5);
    expect(result).toBe("finally-ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows non-UNIQUE errors immediately without retrying", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("FOREIGN KEY constraint failed"));
    await expect(retryOnPositionConflict(fn, 5)).rejects.toThrow(
      "FOREIGN KEY constraint failed",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error after exhausting maxAttempts on persistent conflicts", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error("UNIQUE constraint failed: task_group.position"));
    await expect(retryOnPositionConflict(fn, 3)).rejects.toThrow(
      /Position conflict persisted after 3 attempts/,
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

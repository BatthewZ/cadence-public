import { describe, expect, it } from "vitest";

import { cn } from "./style";

describe("cn", () => {
  it("merges multiple class strings", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles undefined values", () => {
    expect(cn("foo", undefined, "bar")).toBe("foo bar");
  });

  it("handles null values", () => {
    expect(cn("foo", null, "bar")).toBe("foo bar");
  });

  it("handles false values (conditional classes)", () => {
    const isActive = false;
    expect(cn("base", isActive && "active")).toBe("base");
  });

  it("handles empty strings", () => {
    expect(cn("foo", "", "bar")).toBe("foo bar");
  });

  it("deduplicates conflicting Tailwind classes", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("returns empty string when no valid classes provided", () => {
    expect(cn(undefined, null, false, "")).toBe("");
  });

  it("preserves non-conflicting classes", () => {
    expect(cn("p-2", "m-4", "text-sm")).toBe("p-2 m-4 text-sm");
  });
});

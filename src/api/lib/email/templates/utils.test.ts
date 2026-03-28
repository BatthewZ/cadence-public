import { describe, expect, it } from "vitest";

import { escapeHtml } from "./utils";

describe("escapeHtml", () => {
  it("escapes < and > characters", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  it("escapes & character", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('class="test"')).toBe("class=&quot;test&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("returns empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("returns string unchanged when no special characters present", () => {
    expect(escapeHtml("hello world 123")).toBe("hello world 123");
  });

  it("handles strings with multiple special characters", () => {
    expect(escapeHtml(`<a href="test">&'`)).toBe(
      "&lt;a href=&quot;test&quot;&gt;&amp;&#39;",
    );
  });

  it("does not double-escape already-escaped entities", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

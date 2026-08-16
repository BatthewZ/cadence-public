import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./safe-redirect";

/**
 * `?redirect=` is attacker-controlled by construction — it lives in a URL that
 * anyone can compose and send. Both auth pages navigate to whatever comes back
 * from this function, so a permissive result is an open redirect: a link that
 * signs the victim in for real and then drops them on a look-alike page. The
 * hostile cases below are the ones that read as relative but are not.
 */
describe("safeRedirectPath", () => {
  it("accepts a same-origin path", () => {
    expect(safeRedirectPath("/invite/abc123")).toBe("/invite/abc123");
  });

  it("preserves query and hash on an accepted path", () => {
    expect(safeRedirectPath("/w/acme/projects?tab=board#task-1")).toBe(
      "/w/acme/projects?tab=board#task-1",
    );
  });

  it("falls back when the parameter is absent", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
  });

  it("rejects an absolute URL", () => {
    expect(safeRedirectPath("https://evil.example/phish")).toBe("/");
    expect(safeRedirectPath("http://evil.example")).toBe("/");
  });

  it("rejects a scheme-relative URL", () => {
    // No scheme, but browsers resolve `//host` against the current one and
    // navigate off-site.
    expect(safeRedirectPath("//evil.example")).toBe("/");
    expect(safeRedirectPath("//evil.example/login")).toBe("/");
  });

  it("rejects a backslash-disguised scheme-relative URL", () => {
    // Several parsers normalise `\` to `/`, so `/\evil.example` can resolve
    // the same way `//evil.example` does.
    expect(safeRedirectPath("/\\evil.example")).toBe("/");
    expect(safeRedirectPath("/\\/evil.example")).toBe("/");
  });

  /**
   * The regression that motivated the parser cross-check. Every value here
   * satisfies all three *shape* rules — single leading slash, no `//` prefix,
   * no backslash — and yet the WHATWG parser removes the embedded TAB/LF/CR
   * before parsing, leaving `//evil.example`, i.e. an off-site absolute URL.
   * `navigate()` hands the string to `history.pushState`, which resolves it the
   * same way and throws `SecurityError`; react-router catches that and falls
   * back to `window.location.assign`, so the victim really does land on the
   * attacker's origin after a genuine sign-in.
   *
   * These assertions fail if the control-character guard OR the same-origin
   * parser check is removed — the two are deliberately redundant, and this is
   * where that redundancy is proved rather than asserted.
   */
  it("rejects a scheme-relative URL disguised with stripped whitespace", () => {
    expect(safeRedirectPath("/\t/evil.example")).toBe("/");
    expect(safeRedirectPath("/\n/evil.example")).toBe("/");
    expect(safeRedirectPath("/\r/evil.example")).toBe("/");
    expect(safeRedirectPath("/\t\t//evil.example")).toBe("/");
    // Trailing/leading C0 is trimmed by the parser rather than removed, so it
    // is refused for the same reason even though it does not re-form a host.
    expect(safeRedirectPath("/dashboard\n")).toBe("/");
  });

  it("rejects non-http schemes that do not start with a slash", () => {
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/");
    expect(safeRedirectPath("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  it("honours an explicit fallback", () => {
    expect(safeRedirectPath("https://evil.example", "/workspaces")).toBe("/workspaces");
  });
});

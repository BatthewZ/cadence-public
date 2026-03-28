import { describe, expect, it } from "vitest";

import { passwordResetEmail } from "./password-reset";

describe("passwordResetEmail", () => {
  it("returns subject, html, and text fields", () => {
    const result = passwordResetEmail({ url: "https://example.com/reset?token=abc" });
    expect(result.subject).toBe("Reset your password");
    expect(result.html).toContain("Reset your password");
    expect(result.text).toContain("Reset your password");
  });

  it("defaults expiresInMinutes to 60", () => {
    const result = passwordResetEmail({ url: "https://example.com/reset" });
    expect(result.html).toContain("60 minutes");
    expect(result.text).toContain("60 minutes");
  });

  it("respects custom expiresInMinutes value", () => {
    const result = passwordResetEmail({
      url: "https://example.com/reset",
      expiresInMinutes: 15,
    });
    expect(result.html).toContain("15 minutes");
    expect(result.text).toContain("15 minutes");
  });

  it("HTML-escapes special characters in URLs", () => {
    const maliciousUrl = 'https://example.com/reset?token=<script>alert("xss")</script>';
    const result = passwordResetEmail({ url: maliciousUrl });
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("includes the URL in text output without escaping", () => {
    const url = "https://example.com/reset?token=abc123";
    const result = passwordResetEmail({ url });
    expect(result.text).toContain(url);
  });
});

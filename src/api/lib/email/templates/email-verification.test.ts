import { describe, expect, it } from "vitest";

import { emailVerificationEmail } from "./email-verification";

describe("emailVerificationEmail", () => {
  it("returns subject, html, and text fields", () => {
    const result = emailVerificationEmail({ url: "https://example.com/verify?token=abc" });
    expect(result.subject).toBe("Verify your email address");
    expect(result.html).toContain("Verify your email address");
    expect(result.text).toContain("Verify your email address");
  });

  it("HTML-escapes special characters in URLs", () => {
    const maliciousUrl = 'https://example.com/verify?token=<script>alert("xss")</script>';
    const result = emailVerificationEmail({ url: maliciousUrl });
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("includes the URL in text output without escaping", () => {
    const url = "https://example.com/verify?token=abc123";
    const result = emailVerificationEmail({ url });
    expect(result.text).toContain(url);
  });
});

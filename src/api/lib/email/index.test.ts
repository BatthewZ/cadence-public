import { describe, expect, it, vi } from "vitest";

import { ConsoleEmailService } from "./console";
import { createEmailService } from "./index";
import { ResendEmailService } from "./resend";

describe("createEmailService", () => {
  it("returns ConsoleEmailService when RESEND_API_KEY is not set", () => {
    const service = createEmailService({});
    expect(service).toBeInstanceOf(ConsoleEmailService);
  });

  it("returns ResendEmailService when RESEND_API_KEY is set", () => {
    const service = createEmailService({ RESEND_API_KEY: "re_test_123" });
    expect(service).toBeInstanceOf(ResendEmailService);
  });

  it("warns when RESEND_API_KEY is set but EMAIL_FROM is not", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createEmailService({ RESEND_API_KEY: "re_test_123" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("EMAIL_FROM is not configured"),
    );
    warnSpy.mockRestore();
  });

  it("does not warn when both RESEND_API_KEY and EMAIL_FROM are set", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createEmailService({
      RESEND_API_KEY: "re_test_123",
      EMAIL_FROM: "noreply@example.com",
    });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

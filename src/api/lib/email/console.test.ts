import { describe, expect, it, vi } from "vitest";

import { ConsoleEmailService } from "./console";
import { DEFAULT_EMAIL_FROM } from "./from";

describe("ConsoleEmailService", () => {
  it("returns an id matching the console-<timestamp> pattern", async () => {
    const service = new ConsoleEmailService();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await service.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });
    expect(result.id).toMatch(/^console-\d+$/);
    vi.restoreAllMocks();
  });

  it("logs email details to console", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = new ConsoleEmailService();
    await service.send({
      to: "user@example.com",
      subject: "Welcome",
      html: "<p>Hello</p>",
      text: "Hello plain text",
    });
    expect(logSpy).toHaveBeenCalledOnce();
    const loggedMessage = logSpy.mock.calls[0][0] as string;
    expect(loggedMessage).toContain("user@example.com");
    expect(loggedMessage).toContain("Welcome");
    expect(loggedMessage).toContain("Hello plain text");
    logSpy.mockRestore();
  });

  it("joins multiple recipients with comma", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = new ConsoleEmailService();
    await service.send({
      to: ["a@example.com", "b@example.com"],
      subject: "Test",
      html: "<p>Hi</p>",
    });
    const loggedMessage = logSpy.mock.calls[0][0] as string;
    expect(loggedMessage).toContain("a@example.com, b@example.com");
    logSpy.mockRestore();
  });

  it("shows '(no text content)' when text is not provided", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = new ConsoleEmailService();
    await service.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hi</p>",
    });
    const loggedMessage = logSpy.mock.calls[0][0] as string;
    expect(loggedMessage).toContain("(no text content)");
    logSpy.mockRestore();
  });

  it("echoes the sender so a misconfigured EMAIL_FROM is visible in dev", async () => {
    // The dev transport sends nothing, so this line is purely diagnostic —
    // but it is the diagnostic that matters. An operator debugging why real
    // mail never arrives can see which sender the same call would have used
    // against Resend without having to configure Resend to find out.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await new ConsoleEmailService().send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hi</p>",
    });
    expect(logSpy.mock.calls[0][0] as string).toContain(DEFAULT_EMAIL_FROM);
    logSpy.mockRestore();
  });

  it("prefers an explicit sender over the injected default", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await new ConsoleEmailService("ops@cadence.app").send({
      to: "test@example.com",
      from: "billing@cadence.app",
      subject: "Test",
      html: "<p>Hi</p>",
    });
    expect(logSpy.mock.calls[0][0] as string).toContain("billing@cadence.app");
    logSpy.mockRestore();
  });
});

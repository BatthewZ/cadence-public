import { describe, expect, it, vi } from "vitest";

import { ConsoleEmailService } from "./console";
import { DEFAULT_EMAIL_FROM } from "./from";
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

  it("warns when EMAIL_FROM is set to whitespace only", () => {
    // `resolveEmailFrom` treats "   " as unset and falls back, but "   " is
    // truthy — so a `!env.EMAIL_FROM` guard stayed silent on it. That made the
    // single hardest misconfiguration to spot by eye (an EMAIL_FROM that looks
    // populated in a secrets UI) the one case that produced no warning at all,
    // while every message went out from the placeholder address and was
    // rejected by Resend. The warning has to fire on exactly the inputs the
    // fallback fires on, or it is worse than no warning.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createEmailService({ RESEND_API_KEY: "re_test_123", EMAIL_FROM: "   " });
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

  it("hands the Resend transport the resolved sender, making the warning true", async () => {
    // The warning above promised that emails "will use noreply@example.com"
    // when EMAIL_FROM is unset. Nothing supplied it: `ResendEmailService`
    // forwarded `message.from` verbatim, so a message with no sender reached
    // the Resend API as `from: undefined` and was rejected. The warning was a
    // false claim standing next to a real bug, which is why this asserts the
    // outbound request rather than the warning text.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = createEmailService({ RESEND_API_KEY: "re_test_123" });
    await service.send({ to: "a@example.com", subject: "s", html: "<p>h</p>" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((JSON.parse(init.body as string) as { from: string }).from).toBe(
      DEFAULT_EMAIL_FROM,
    );
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hands the Resend transport a configured EMAIL_FROM", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_2" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = createEmailService({
      RESEND_API_KEY: "re_test_123",
      EMAIL_FROM: "ops@cadence.app",
    });
    await service.send({ to: "a@example.com", subject: "s", html: "<p>h</p>" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((JSON.parse(init.body as string) as { from: string }).from).toBe(
      "ops@cadence.app",
    );
    vi.unstubAllGlobals();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EMAIL_FROM } from "./from";
import { ResendEmailService } from "./resend";

function jsonResponse(body: object, status = 200, statusText = "OK") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number, statusText: string) {
  return new Response(body, { status, statusText });
}

describe("ResendEmailService", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const apiKey = "re_test_abc123";
  let service: ResendEmailService;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    service = new ResendEmailService(apiKey);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends email via Resend API with correct URL and POST method", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "msg_1" }));

    await service.send({
      to: "user@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
  });

  it("includes API key in Authorization header as Bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "msg_2" }));

    await service.send({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Hi</p>",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${apiKey}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends correct JSON body with all fields", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "msg_3" }));

    await service.send({
      to: ["a@example.com", "b@example.com"],
      from: "sender@example.com",
      subject: "Welcome",
      html: "<h1>Hello</h1>",
      text: "Hello plain",
      replyTo: "reply@example.com",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      to: ["a@example.com", "b@example.com"],
      from: "sender@example.com",
      subject: "Welcome",
      html: "<h1>Hello</h1>",
      text: "Hello plain",
      reply_to: "reply@example.com",
    });
  });

  it("wraps a single 'to' string into an array", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "msg_4" }));

    await service.send({
      to: "solo@example.com",
      subject: "Single",
      html: "<p>One</p>",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.to).toEqual(["solo@example.com"]);
  });

  it("passes through an array 'to' as-is", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "msg_5" }));

    const recipients = ["x@example.com", "y@example.com", "z@example.com"];
    await service.send({
      to: recipients,
      subject: "Multi",
      html: "<p>Many</p>",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.to).toEqual(recipients);
  });

  it("returns { id } from a successful response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "msg_success_42" }));

    const result = await service.send({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Ok</p>",
    });

    expect(result).toEqual({ id: "msg_success_42" });
  });

  it("throws on non-OK response with status and body in error message", async () => {
    fetchMock.mockResolvedValueOnce(
      textResponse('{"message":"Invalid API key"}', 403, "Forbidden")
    );

    await expect(
      service.send({
        to: "user@example.com",
        subject: "Fail",
        html: "<p>No</p>",
      })
    ).rejects.toThrow(
      'Resend API error (403 Forbidden): {"message":"Invalid API key"}'
    );
  });

  it("throws on network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(
      service.send({
        to: "user@example.com",
        subject: "Unreachable",
        html: "<p>Err</p>",
      })
    ).rejects.toThrow("fetch failed");
  });

  it("supplies the default sender when a message omits 'from'", async () => {
    // The Resend API rejects a request whose `from` is absent, and on the
    // invitation path that rejection is swallowed into a log line — so a
    // message reaching this transport without a sender used to mean "the
    // invitation silently never arrives". The transport now refuses to
    // construct that request at all.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "msg_default_from" }));

    await service.send({
      to: "user@example.com",
      subject: "No sender supplied",
      html: "<p>Hi</p>",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.from).toBe(DEFAULT_EMAIL_FROM);
  });

  it("prefers an explicit 'from' over the injected default", async () => {
    // The default is a floor, not an override: a deployment that configured
    // EMAIL_FROM must still send as itself.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "msg_explicit_from" }));
    const configured = new ResendEmailService(apiKey, "ops@cadence.app");

    await configured.send({
      to: "user@example.com",
      from: "billing@cadence.app",
      subject: "Explicit",
      html: "<p>Hi</p>",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.from).toBe("billing@cadence.app");
  });

  it("uses the sender injected at construction when none is supplied", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "msg_injected_from" }));
    const configured = new ResendEmailService(apiKey, "ops@cadence.app");

    await configured.send({
      to: "user@example.com",
      subject: "Injected",
      html: "<p>Hi</p>",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.from).toBe("ops@cadence.app");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});

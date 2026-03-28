import type { EmailMessage, EmailSendResult, EmailService } from "./types";

export class ConsoleEmailService implements EmailService {
  // eslint-disable-next-line @typescript-eslint/require-await
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const to = Array.isArray(message.to) ? message.to.join(", ") : message.to;
    const preview = message.text
      ? message.text.slice(0, 200)
      : "(no text content)";

    console.log(
      [
        "",
        "=".repeat(60),
        "[DEV EMAIL] This is a dev-only fallback — no email was sent",
        "=".repeat(60),
        `  To:      ${to}`,
        `  Subject: ${message.subject}`,
        `  Preview: ${preview}`,
        "=".repeat(60),
        "",
      ].join("\n")
    );

    return { id: `console-${Date.now()}` };
  }
}

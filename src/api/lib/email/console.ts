import { DEFAULT_EMAIL_FROM } from "./from";
import type { EmailMessage, EmailSendResult, EmailService } from "./types";

export class ConsoleEmailService implements EmailService {
  private readonly defaultFrom: string;

  /**
   * @param defaultFrom Sender echoed when a message omits `from`. The dev
   *   transport does not send anything, so this is purely diagnostic — but it
   *   is the diagnostic that matters: an operator debugging why real mail is
   *   not arriving can see which sender the same call would have used against
   *   Resend, without having to configure Resend to find out.
   */
  constructor(defaultFrom: string = DEFAULT_EMAIL_FROM) {
    this.defaultFrom = defaultFrom;
  }

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
        `  From:    ${message.from ?? this.defaultFrom}`,
        `  Subject: ${message.subject}`,
        `  Preview: ${preview}`,
        "=".repeat(60),
        "",
      ].join("\n")
    );

    return { id: `console-${Date.now()}` };
  }
}

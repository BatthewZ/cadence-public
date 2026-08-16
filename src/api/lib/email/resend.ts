import { DEFAULT_EMAIL_FROM } from "./from";
import type { EmailMessage, EmailSendResult, EmailService } from "./types";

const RESEND_API_URL = "https://api.resend.com/emails";

export class ResendEmailService implements EmailService {
  private readonly apiKey: string;
  private readonly defaultFrom: string;

  /**
   * @param defaultFrom Sender used when a message omits `from`. Defaulted here
   *   as well as in `createEmailService` so that a transport constructed
   *   directly — in a test, or by a future caller — can never post
   *   `from: undefined` to the Resend API. That request fails with a 4xx the
   *   invitation path is designed to swallow, which is how an unset
   *   `EMAIL_FROM` used to mean "no invitation ever arrives" with nothing but
   *   a log line to show for it.
   */
  constructor(apiKey: string, defaultFrom: string = DEFAULT_EMAIL_FROM) {
    this.apiKey = apiKey;
    this.defaultFrom = defaultFrom;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: Array.isArray(message.to) ? message.to : [message.to],
        from: message.from ?? this.defaultFrom,
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: message.replyTo,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Resend API error (${response.status} ${response.statusText}): ${body}`
      );
    }

    const data: { id: string } = await response.json();
    return { id: data.id };
  }
}

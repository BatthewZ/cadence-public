import type { EmailMessage, EmailSendResult, EmailService } from "./types";

const RESEND_API_URL = "https://api.resend.com/emails";

export class ResendEmailService implements EmailService {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
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
        from: message.from,
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

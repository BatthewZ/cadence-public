import { ConsoleEmailService } from "./console";
import { ResendEmailService } from "./resend";
import type { EmailService } from "./types";

export function createEmailService(env: {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}): EmailService {
  if (env.RESEND_API_KEY) {
    if (!env.EMAIL_FROM) {
      console.warn(
        "[Email] RESEND_API_KEY is set but EMAIL_FROM is not configured. Emails will use 'noreply@example.com' which will likely be rejected by Resend.",
      );
    }
    return new ResendEmailService(env.RESEND_API_KEY);
  }
  return new ConsoleEmailService();
}

export { ConsoleEmailService } from "./console";
export { ResendEmailService } from "./resend";
export type { EmailMessage, EmailSendResult, EmailService } from "./types";

import { ConsoleEmailService } from "./console";
import { DEFAULT_EMAIL_FROM, resolveEmailFrom } from "./from";
import { ResendEmailService } from "./resend";
import type { EmailService } from "./types";

/**
 * Build the transport for this deployment, pre-loaded with the sender address.
 *
 * The transport carries the resolved `From:` so that a caller which omits
 * `from` still produces a well-formed message. Until this change the warning
 * below was simply untrue — nothing supplied the fallback it promised, and a
 * message without `from` reached the Resend API as `from: undefined`. See
 * `./from.ts` for why that mattered only on the invitation path.
 */
export function createEmailService(env: {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}): EmailService {
  const defaultFrom = resolveEmailFrom(env);
  if (env.RESEND_API_KEY) {
    // `.trim()` so the warning fires on exactly the inputs the fallback fires
    // on. `resolveEmailFrom` treats a whitespace-only EMAIL_FROM as unset, but
    // `"   "` is truthy — so without this the one misconfiguration hardest to
    // spot by eye was also the one that produced no warning, and the
    // deployment silently sent every message from the placeholder address.
    if (!env.EMAIL_FROM?.trim()) {
      console.warn(
        `[Email] RESEND_API_KEY is set but EMAIL_FROM is not configured. Emails will use '${DEFAULT_EMAIL_FROM}' which will likely be rejected by Resend.`,
      );
    }
    return new ResendEmailService(env.RESEND_API_KEY, defaultFrom);
  }
  return new ConsoleEmailService(defaultFrom);
}

export { ConsoleEmailService } from "./console";
export { ResendEmailService } from "./resend";
export type { EmailMessage, EmailSendResult, EmailService } from "./types";

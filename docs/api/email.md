# Email Service

## Overview

The email service (`src/api/lib/email/`) provides a pluggable interface for sending transactional emails. It ships with two implementations:

- **`ResendEmailService`** -- sends real emails via the [Resend](https://resend.com) HTTP API (no SDK dependency).
- **`ConsoleEmailService`** -- logs email details to the console. Used automatically when `RESEND_API_KEY` is not set.

The factory function `createEmailService(env)` selects the implementation based on the environment.

## Architecture

```
src/api/lib/email/
├── index.ts          # createEmailService factory + re-exports
├── types.ts          # EmailService interface, EmailMessage, EmailSendResult
├── resend.ts         # ResendEmailService (HTTP fetch, no SDK)
├── console.ts        # ConsoleEmailService (dev fallback)
└── templates/        # Email template functions
    ├── utils.ts      # Shared escapeHtml utility
    ├── password-reset.ts
    └── email-verification.ts
```

## EmailService Interface

```ts
interface EmailMessage {
  to: string | string[];
  from?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

interface EmailSendResult {
  id: string;
}

interface EmailService {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
```

## Factory

```ts
import { createEmailService } from "./email";

const emailService = createEmailService(env);
// Returns ResendEmailService if env.RESEND_API_KEY is set,
// otherwise returns ConsoleEmailService.
```

The factory emits a `console.warn` if `RESEND_API_KEY` is set but `EMAIL_FROM` is not configured, since Resend will likely reject emails sent from the default `noreply@example.com`.

## Implementations

### ResendEmailService

Sends emails via the Resend REST API (`POST https://api.resend.com/emails`). Uses `fetch` directly -- no external SDK. Throws on non-2xx responses with the status code and response body.

### ConsoleEmailService

Logs the recipient, subject, and a text preview to the console. Returns a synthetic `id` of `console-{timestamp}`. Used in local development so auth flows work without an API key.

## Templates

Template functions accept options and return `{ subject, html, text }`. All user-supplied values are escaped via `escapeHtml()`.

| Template | Function | Purpose |
|---|---|---|
| `password-reset.ts` | `passwordResetEmail({ url, expiresInMinutes? })` | Password reset email with a CTA button and fallback link. Default expiry: 60 minutes. |
| `email-verification.ts` | `emailVerificationEmail({ url })` | Email verification email with a CTA button and fallback link. |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | No | Resend API key. When absent, the console fallback is used. |
| `EMAIL_FROM` | No | Sender address for emails. Defaults to `noreply@example.com`. |

See [Auth Environment Variables](../auth/environment.md) for the full list.

## Usage in Auth

The email service is created inside `createAuth(env)` and used by two Better Auth callbacks:

- `emailAndPassword.sendResetPassword` -- sends the password reset email.
- `emailVerification.sendVerificationEmail` -- sends the email verification email.

See [Auth Configuration](../auth/configuration.md) for the full setup.

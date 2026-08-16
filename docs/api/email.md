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
├── from.ts           # resolveEmailFrom + DEFAULT_EMAIL_FROM (single source of truth for the sender)
├── types.ts          # EmailService interface, EmailMessage, EmailSendResult
├── resend.ts         # ResendEmailService (HTTP fetch, no SDK)
├── console.ts        # ConsoleEmailService (dev fallback)
└── templates/        # Email template functions
    ├── utils.ts      # Shared escapeHtml utility
    ├── password-reset.ts
    ├── email-verification.ts
    ├── workspace-invitation.ts
    ├── api-token-created.ts
    ├── api-token-rotated.ts
    ├── api-token-revoked.ts
    └── webhook-created.ts
```

`from.ts` is its own module rather than part of `index.ts` so the transports can depend on it without an import cycle — the barrel imports them, so they must not import the barrel back.

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

The factory resolves the sender once with `resolveEmailFrom(env)` and hands it to the transport as its `defaultFrom`, so a message that omits `from` is still well-formed. It also emits a `console.warn` if `RESEND_API_KEY` is set but `EMAIL_FROM` is not configured, since Resend will likely reject emails sent from the default `noreply@example.com`.

## Sender Address

Every outbound email resolves its `From:` through `resolveEmailFrom(env)` in `from.ts`, which returns `EMAIL_FROM` when it holds a non-blank value and `DEFAULT_EMAIL_FROM` (`noreply@example.com`) otherwise. Without qualification, all five senders go through this one function:

| Email | Sent from | Trigger |
|---|---|---|
| Password reset | `lib/auth.ts` | Better Auth `sendResetPassword` callback |
| Email verification | `lib/auth.ts` | Better Auth `sendVerificationEmail` callback |
| Workspace invitation | `routes/invitations/invitations.handlers.ts` | `POST /api/workspaces/:workspaceId/invitations` |
| API-token created / rotated / revoked notice | `routes/workspaces/api-tokens.handlers.ts` | create, rotate, and revoke on `/api/workspaces/:workspaceId/api-tokens` |
| Webhook-created notice | `lib/webhooks/notify.ts` | `POST /api/workspaces/:workspaceId/webhooks` |

Every sender except the two Better Auth callbacks runs through `deferWork` after the response has been returned, and swallows its own failures into a log line — the row is already committed, so a dead mail provider must not turn a successful write into an error the caller is told to retry.

**Why a resolver and not `env.EMAIL_FROM ?? "..."` at each call site:** it used to be exactly that, and the copies drifted. `auth.ts` applied the fallback, so password-reset and verification mail always carried a sender; the other paths passed the raw binding straight through. A deployment with `RESEND_API_KEY` set but `EMAIL_FROM` unset therefore handed Resend `from: undefined`, Resend rejected the request, and `sendInvitationEmail` swallowed the throw into a log line **by design** (it must not fail an already-committed 201). The symptom was the worst kind available: password resets kept working, so mail "was working", while every invitation disappeared with nothing the sending admin could see. One resolver means a newly added mail sender cannot reintroduce that asymmetry by forgetting the `??`.

**Why blank values fall back too:** `??` only catches `undefined`. An `EMAIL_FROM=` line in `.dev.vars`, or a Workers secret that was declared and later cleared, reads as "configured" to `??` and then fails in exactly the silent way the fallback exists to prevent. Whitespace-only values are treated identically.

`DEFAULT_EMAIL_FROM` uses an RFC 2606 reserved domain deliberately: it can never belong to a real install, so a provider that rejects it tells the operator the truth loudly instead of delivering mail from a domain this deployment does not own.

## Implementations

### ResendEmailService

Sends emails via the Resend REST API (`POST https://api.resend.com/emails`). Uses `fetch` directly -- no external SDK. Throws on non-2xx responses with the status code and response body.

Constructed as `new ResendEmailService(apiKey, defaultFrom)`; a message without `from` is sent with `defaultFrom`. That parameter itself defaults to `DEFAULT_EMAIL_FROM`, so a transport constructed directly — in a test, or by a future caller — can never post `from: undefined` to the Resend API.

### ConsoleEmailService

Logs the recipient, sender, subject, and a text preview to the console. Returns a synthetic `id` of `console-{timestamp}`. Used in local development so auth and invitation flows work without an API key.

Constructed as `new ConsoleEmailService(defaultFrom)` and echoes that address when a message omits `from`. Purely diagnostic — the dev transport sends nothing — but it is the diagnostic that matters: an operator debugging why real mail is not arriving can see which sender the same call would have used against Resend, without configuring Resend to find out.

## Templates

Template functions accept options and return `{ subject, html, text }`. All user-supplied values are escaped via `escapeHtml()`.

| Template | Function | Purpose |
|---|---|---|
| `password-reset.ts` | `passwordResetEmail({ url, expiresInMinutes? })` | Password reset email with a CTA button and fallback link. Default expiry: 60 minutes. |
| `email-verification.ts` | `emailVerificationEmail({ url })` | Email verification email with a CTA button and fallback link. |
| `workspace-invitation.ts` | `workspaceInvitationEmail({ workspaceName, inviterName, role, url })` | Workspace invitation email with a CTA button and fallback `/invite/:token` link. Sent to **every** invitee, account or not — previously someone without an account received nothing at all, so onboarding a new person through the product was impossible. |
| `api-token-created.ts` | `apiTokenCreatedEmail({ recipientName, tokenName, workspaceName, scopes, createdAt, settingsUrl })` | Notice to the token owner that a Personal Access Token was issued, listing the granted scopes. |
| `api-token-rotated.ts` | `apiTokenRotatedEmail({ recipientName, tokenName, workspaceName, rotatedAt, oldTokenPrefix, revokeAt, settingsUrl })` | Notice that a token was rotated, naming the old token's prefix and the date the grace period ends. |
| `api-token-revoked.ts` | `apiTokenRevokedEmail({ recipientName, tokenName, workspaceName, revokedAt, revokedByAdmin, settingsUrl })` | Notice that a token was revoked; `revokedByAdmin` distinguishes "you did this" from "an admin did this to you". |
| `webhook-created.ts` | `webhookCreatedEmail({ recipientName, workspaceName, webhookName, webhookUrl, events, projectName, createdVia, createdAt, settingsUrl })` | Notice that a webhook subscription was registered. Shows the destination URL as plain text (never a link), the subscribed events, the project scope (`null` = workspace-wide), and whether it was created by a cookie session or a named API token — the field that lets the owner correlate against their own integrations. |

The three API-token notices and the webhook notice exist because both objects are long-lived grants that outlive the request that created them; an out-of-band message is the owner's first chance to notice one they did not expect. See [API Tokens](./api-tokens.md) and [Webhooks](./webhooks.md).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | No | Resend API key. When absent, the console fallback is used. |
| `EMAIL_FROM` | No | Sender address for **all** outbound email — auth (password reset, verification) and workspace invitations alike. Falls back to `noreply@example.com` when unset, empty, or whitespace-only. |

See [Auth Environment Variables](../auth/environment.md) for the full list.

## Usage in Auth

The email service is created inside `createAuth(env)` and used by two Better Auth callbacks:

- `emailAndPassword.sendResetPassword` -- checks a D1-backed cooldown (`isResetCooldownActive` in `src/api/lib/password-reset-cooldown.ts`) to suppress duplicate emails within 5 minutes, then sends the password reset email. This distributed cooldown works across all Worker isolates, unlike the in-memory rate limiter.
- `emailVerification.sendVerificationEmail` -- sends the email verification email.

See [Auth Configuration](../auth/configuration.md) for the full setup.

## Usage in Invitations

`createInvitation` builds a transport per request and sends `workspaceInvitationEmail` through `deferWork`, after the 201 has been returned. Two deliberate properties:

- **It never throws.** The invitation row is already committed, so a dead mail provider must not turn a successful invitation into a 500 telling the admin to retry — the retry would then trip the duplicate-pending guard and leave them stuck. Failures are logged, and the copy-link control on the members page is the operator's recovery path.
- **It resolves the sender through `resolveEmailFrom`**, not `env.EMAIL_FROM`, for the reason in [Sender Address](#sender-address).

With no `RESEND_API_KEY` — the default for self-hosted installs — the console transport keeps the invite link visible in the logs rather than discarding it silently.

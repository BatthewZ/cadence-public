/**
 * The single source of truth for the `From:` address on every outbound email.
 *
 * Lives in its own module rather than in `./index.ts` so that the transports
 * (`./console`, `./resend`) can depend on it without an import cycle — the
 * barrel imports them, so they must not import the barrel back.
 */

/**
 * Sender address used when a deployment has not configured `EMAIL_FROM`.
 *
 * Deliberately an RFC 2606 reserved domain: it can never belong to a real
 * install, so a provider that rejects it is telling the operator the truth
 * loudly instead of delivering mail from a domain this deployment does not
 * own.
 */
export const DEFAULT_EMAIL_FROM = "noreply@example.com";

/**
 * Resolve the `From:` address for an outbound email.
 *
 * ## Why this is a function and not `env.EMAIL_FROM ?? "…"` at each call site
 *
 * It used to be exactly that, and the copies drifted. `src/api/lib/auth.ts`
 * applied the fallback, so password-reset and verification mail always carried
 * a sender. The invitation path passed `env.EMAIL_FROM` straight through, so a
 * deployment with `RESEND_API_KEY` set but `EMAIL_FROM` unset handed
 * `ResendEmailService` an `undefined` sender, Resend rejected the request, and
 * `sendInvitationEmail` swallowed the throw into a log line by design (it must
 * not fail the already-committed 201). The observable symptom was the worst
 * kind available: password resets kept working, so mail "was working", while
 * every single invitation disappeared without a trace visible to the admin who
 * sent it. One resolver means a newly added mail sender cannot reintroduce
 * that asymmetry by forgetting the `??`.
 *
 * ## Why empty strings fall back too
 *
 * `??` only catches `undefined`. An `EMAIL_FROM=""` line in `.dev.vars`, or a
 * Workers secret that was declared and then cleared, reads as "configured" to
 * `??` and then fails in exactly the same silent way the fallback exists to
 * prevent. Whitespace-only values are treated the same, for the same reason.
 */
export function resolveEmailFrom(env: { EMAIL_FROM?: string }): string {
  return env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
}

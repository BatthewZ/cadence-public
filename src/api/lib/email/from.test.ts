import { describe, expect, it } from "vitest";

import { DEFAULT_EMAIL_FROM, resolveEmailFrom } from "./from";

/**
 * The resolver exists because the fallback used to be an inline
 * `env.EMAIL_FROM ?? "…"` written once in `src/api/lib/auth.ts` and forgotten
 * on the invitation path. The consequence was asymmetric and therefore almost
 * undiagnosable from the outside: on a deployment with `RESEND_API_KEY` set but
 * `EMAIL_FROM` unset, password-reset and verification mail kept arriving while
 * every workspace invitation was rejected by Resend for having no sender — and
 * `sendInvitationEmail` swallows send failures by design, so the only trace was
 * a log line nobody was reading.
 *
 * These cases pin the two properties that make the resolver worth having: it
 * never returns something unsendable, and it never overrides a real setting.
 */
describe("resolveEmailFrom", () => {
  it("returns a configured EMAIL_FROM unchanged", () => {
    // The failure this guards is a fallback that became an override, which
    // would silently break every correctly configured deployment at once.
    expect(resolveEmailFrom({ EMAIL_FROM: "hello@cadence.app" })).toBe(
      "hello@cadence.app",
    );
  });

  it("falls back when EMAIL_FROM is absent", () => {
    expect(resolveEmailFrom({})).toBe(DEFAULT_EMAIL_FROM);
    expect(resolveEmailFrom({ EMAIL_FROM: undefined })).toBe(DEFAULT_EMAIL_FROM);
  });

  it("falls back on empty and whitespace-only values", () => {
    // `??` alone would let these through: an `EMAIL_FROM=""` line in
    // `.dev.vars`, or a Workers secret that was declared and then cleared,
    // reads as "configured" and then fails in exactly the silent way the
    // fallback exists to prevent.
    expect(resolveEmailFrom({ EMAIL_FROM: "" })).toBe(DEFAULT_EMAIL_FROM);
    expect(resolveEmailFrom({ EMAIL_FROM: "   " })).toBe(DEFAULT_EMAIL_FROM);
    expect(resolveEmailFrom({ EMAIL_FROM: "\n\t" })).toBe(DEFAULT_EMAIL_FROM);
  });

  it("trims a padded address rather than rejecting it", () => {
    // A trailing newline is what a value pasted into a secrets UI most often
    // carries, and Resend rejects the header outright if it survives.
    expect(resolveEmailFrom({ EMAIL_FROM: "  ops@cadence.app\n" })).toBe(
      "ops@cadence.app",
    );
  });

  it("uses a reserved domain as the default", () => {
    // RFC 2606 guarantees `example.com` belongs to nobody, so a deployment
    // that reaches the fallback gets a loud provider rejection instead of
    // sending mail that claims to come from a domain it does not own.
    expect(DEFAULT_EMAIL_FROM).toBe("noreply@example.com");
  });
});

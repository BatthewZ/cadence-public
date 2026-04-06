import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

import { Text } from "@/web/components/ui";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useForceDefaultTheme } from "@/web/hooks/use-force-default-theme";

/**
 * Public-facing Privacy Policy page.
 *
 * Uses the same centered prose layout as the Terms of Service page so
 * legal/policy pages share a consistent reading experience. No auth required.
 */
export function Privacy() {
  useDocumentTitle("Privacy Policy");
  useForceDefaultTheme();

  return (
    <div className="min-h-screen bg-surface-1">
      {/* Sticky header bar */}
      <header className="sticky top-0 z-10 border-b border-border-default bg-surface-0/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4 sm:px-8">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-fg-secondary transition-colors hover:text-fg-primary"
          >
            <ArrowLeft size={16} />
            <span>Home</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <article className="mx-auto max-w-3xl px-6 py-12 sm:px-8 sm:py-16">
        <Text variant="h2" as="h1" className="mb-2">
          Privacy Policy
        </Text>
        <Text variant="body-2" color="muted" className="mb-10">
          Effective date: April 5, 2026
        </Text>

        <div className="space-y-10">
          {/* Intro */}
          <section>
            <Text variant="body-1" color="secondary">
              Cadence is an open-source project management tool built as a passion project.
              This policy explains what data we collect, why, and what we do (and don't do) with it.
              We believe in being straightforward — no legalese walls, no buried clauses.
            </Text>
          </section>

          {/* 1. Information We Collect */}
          <section className="space-y-4">
            <Text variant="h4" as="h2">
              1. Information We Collect
            </Text>

            <div className="space-y-3">
              <div>
                <Text variant="body-1" weight="semibold">
                  Account information
                </Text>
                <Text variant="body-1" color="secondary">
                  Your name, email address, and optionally a profile image. This is what you provide
                  when you sign up.
                </Text>
              </div>

              <div>
                <Text variant="body-1" weight="semibold">
                  Session data
                </Text>
                <Text variant="body-1" color="secondary">
                  Your IP address and user agent (browser info) are stored for session management.
                  We use this to keep your login secure, not to track you.
                </Text>
              </div>

              <div>
                <Text variant="body-1" weight="semibold">
                  User content
                </Text>
                <Text variant="body-1" color="secondary">
                  Everything you create within the Service: workspaces, projects, tasks, comments,
                  labels, attachments, and any other content. This is your data — we store it so
                  the app works.
                </Text>
              </div>

              <div>
                <Text variant="body-1" weight="semibold">
                  File uploads
                </Text>
                <Text variant="body-1" color="secondary">
                  Attachments and cover images you upload are stored via Cloudflare R2.
                </Text>
              </div>
            </div>
          </section>

          {/* 2. How We Use Your Information */}
          <section className="space-y-4">
            <Text variant="h4" as="h2">
              2. How We Use Your Information
            </Text>
            <Text variant="body-1" color="secondary">
              Your data exists for one reason: to make Cadence work for you.
            </Text>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  To provide and operate the Service — your workspaces, projects, and tasks need
                  to live somewhere.
                </Text>
              </li>
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  To send transactional emails (verification, password reset) via Resend when
                  email delivery is configured.
                </Text>
              </li>
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  To maintain session security — keeping your account safe.
                </Text>
              </li>
            </ul>
            <Text variant="body-1" color="secondary" weight="semibold">
              We do NOT use your data for analytics, advertising, profiling, or any purpose beyond
              running the Service. There are no trackers, no pixel tags, no behavioral analysis.
            </Text>
          </section>

          {/* 3. Data Storage & Security */}
          <section className="space-y-4">
            <Text variant="h4" as="h2">
              3. Data Storage &amp; Security
            </Text>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  <strong className="text-fg-primary">Database:</strong> Cloudflare D1 (SQLite
                  running on Cloudflare's global network).
                </Text>
              </li>
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  <strong className="text-fg-primary">File storage:</strong> Cloudflare R2 for
                  attachments and uploaded images.
                </Text>
              </li>
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  <strong className="text-fg-primary">Passwords:</strong> Hashed and never stored
                  in plain text. We cannot see your password.
                </Text>
              </li>
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  <strong className="text-fg-primary">Sessions:</strong> Managed with secure,
                  httpOnly cookies.
                </Text>
              </li>
            </ul>
            <Text variant="body-1" color="secondary">
              We follow security best practices, but we're honest: no system is 100% secure. If a
              security issue arises, we'll address it promptly and transparently.
            </Text>
          </section>

          {/* 4. Third-Party Services */}
          <section className="space-y-4">
            <Text variant="h4" as="h2">
              4. Third-Party Services
            </Text>
            <Text variant="body-1" color="secondary">
              We use a minimal set of third-party services to operate Cadence:
            </Text>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  <strong className="text-fg-primary">Cloudflare</strong> — hosting, database
                  (D1), and file storage (R2). Your data lives on Cloudflare's infrastructure.
                </Text>
              </li>
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  <strong className="text-fg-primary">Resend</strong> — transactional email
                  delivery only (verification, password reset), when configured.
                </Text>
              </li>
            </ul>
            <Text variant="body-1" color="secondary" weight="semibold">
              We do not sell, trade, or share your personal data with anyone. Full stop.
            </Text>
          </section>

          {/* 5. Data Retention & Deletion */}
          <section className="space-y-4">
            <Text variant="h4" as="h2">
              5. Data Retention &amp; Deletion
            </Text>
            <Text variant="body-1" color="secondary">
              Your data is retained for as long as your account exists. There's no hidden
              retention after deletion.
            </Text>
            <Text variant="body-1" color="secondary">
              You can delete your account at any time from{" "}
              <strong className="text-fg-primary">Settings</strong>. When you do, we permanently
              delete your user record, sessions, workspace memberships, and all associated
              content. This is a cascading, irreversible operation — once it's gone, it's gone.
            </Text>
          </section>

          {/* 6. Your Rights */}
          <section className="space-y-4">
            <Text variant="h4" as="h2">
              6. Your Rights
            </Text>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  <strong className="text-fg-primary">Access:</strong> You can view your profile
                  data at any time in Settings.
                </Text>
              </li>
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  <strong className="text-fg-primary">Deletion:</strong> You can delete your
                  account and all associated data at any time.
                </Text>
              </li>
              <li>
                <Text variant="body-1" color="secondary" as="span">
                  <strong className="text-fg-primary">Export:</strong> We don't currently offer
                  bulk data export, but this may be added in the future.
                </Text>
              </li>
            </ul>
          </section>

          {/* 7. Children's Privacy */}
          <section className="space-y-4">
            <Text variant="h4" as="h2">
              7. Children's Privacy
            </Text>
            <Text variant="body-1" color="secondary">
              Cadence is not directed at individuals under the age of 18. We do not knowingly
              collect personal data from minors. If you believe a minor has provided us with their
              information, please reach out so we can remove it.
            </Text>
          </section>

          {/* 8. Changes to This Policy */}
          <section className="space-y-4">
            <Text variant="h4" as="h2">
              8. Changes to This Policy
            </Text>
            <Text variant="body-1" color="secondary">
              We may update this Privacy Policy from time to time. When we do, we'll update the
              effective date at the top. Continued use of Cadence after changes are posted
              constitutes acceptance of the updated policy.
            </Text>
          </section>

          {/* 9. Contact */}
          <section className="space-y-4">
            <Text variant="h4" as="h2">
              9. Contact
            </Text>
            <Text variant="body-1" color="secondary">
              If you have questions or concerns about this Privacy Policy, you can reach the
              developer via the{" "}
              <a
                href="https://github.com/BatthewZ/cadence-public"
                target="_blank"
                rel="noopener noreferrer"
                className="text-fg-primary underline underline-offset-2 transition-colors hover:text-accent"
              >
                GitHub repository
              </a>
              . Open an issue or start a discussion — we're happy to help.
            </Text>
          </section>
        </div>

        {/* Footer nav */}
        <div className="mt-16 flex items-center justify-between border-t border-border-default pt-8">
          <Link
            to="/"
            className="text-sm text-fg-secondary transition-colors hover:text-fg-primary"
          >
            Back to Home
          </Link>
          <Link
            to="/terms"
            className="text-sm text-fg-secondary transition-colors hover:text-fg-primary"
          >
            Terms of Service
          </Link>
        </div>
      </article>
    </div>
  );
}

export default Privacy;

import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

import { Stack } from "@/web/components/layout";
import { Text } from "@/web/components/ui";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useForceDefaultTheme } from "@/web/hooks/use-force-default-theme";

export function Terms() {
  useDocumentTitle("Terms of Service");
  useForceDefaultTheme();

  return (
    <div className="min-h-screen bg-surface-1">
      <div className="mx-auto max-w-3xl px-6 py-r1 sm:px-8">
        <Link
          to="/"
          className="mb-r3 inline-flex items-center gap-r5 text-body-2 text-fg-secondary transition-colors hover:text-fg-primary"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        <Stack gap="r2" as="article">
          <header>
            <Text variant="h2" as="h1">Terms of Service</Text>
            <Text variant="body-2" color="muted" className="mt-r5">
              Effective Date: April 5, 2026
            </Text>
          </header>

          {/* 1. Acceptance of Terms */}
          <section>
            <Text variant="h5" as="h2" className="mb-r5">
              1. Acceptance of Terms
            </Text>
            <Text variant="body-1" color="secondary">
              By accessing or using Cadence (the &ldquo;Service&rdquo;), you agree to be bound by
              these Terms. If you are self-hosting this software, these terms do not apply to your
              private instance, but the software remains subject to its license.
            </Text>
          </section>

          {/* 2. Nature of Service */}
          <section>
            <Text variant="h5" as="h2" className="mb-r5">
              2. Nature of Service
            </Text>
            <Text variant="body-1" color="secondary">
              The Service is a passion project offered for free and hosted by the developer using
              Cloudflare&rsquo;s infrastructure. The developer reserves the right to modify, suspend,
              or discontinue the Service (or any part thereof) at any time, with or without notice.
            </Text>
          </section>

          {/* 3. Data & Privacy */}
          <section>
            <Text variant="h5" as="h2" className="mb-r5">
              3. Data &amp; Privacy
            </Text>
            <Stack gap="r4" as="ul" className="list-disc pl-6">
              <li>
                <Text variant="body-1" color="secondary" as="span" weight="semibold">
                  User Content:
                </Text>{" "}
                <Text variant="body-1" color="secondary" as="span">
                  You retain all rights to the data you input. By using the Service, you grant the
                  developer a limited license to store and transmit this data solely to provide the
                  Service to you.
                </Text>
              </li>
              <li>
                <Text variant="body-1" color="secondary" as="span" weight="semibold">
                  Privacy:
                </Text>{" "}
                <Text variant="body-1" color="secondary" as="span">
                  We do not sell or trade your data. While the developer has the technical ability to
                  access the database for maintenance and troubleshooting, there is no intention to
                  monitor or read private user data.
                </Text>
              </li>
              <li>
                <Text variant="body-1" color="secondary" as="span" weight="semibold">
                  Security:
                </Text>{" "}
                <Text variant="body-1" color="secondary" as="span">
                  Data is stored using Cloudflare D1. While we follow industry best practices, no web
                  service is 100% secure. Use the Service at your own risk.
                </Text>
              </li>
            </Stack>
          </section>

          {/* 4. No Warranty ("As-Is") */}
          <section>
            <Text variant="h5" as="h2" className="mb-r5">
              4. No Warranty (&ldquo;As-Is&rdquo;)
            </Text>
            <Text
              variant="body-2"
              color="secondary"
              className="rounded-lg border border-border-default bg-surface-2 p-r4"
            >
              THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE.&rdquo; TO THE
              MAXIMUM EXTENT PERMITTED BY LAW, THE DEVELOPER DISCLAIMS ALL WARRANTIES, EXPRESS OR
              IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
              PARTICULAR PURPOSE, AND NON-INFRINGEMENT. THERE IS NO GUARANTEE THAT THE SERVICE WILL
              BE UNINTERRUPTED, TIMELY, SECURE, OR ERROR-FREE.
            </Text>
          </section>

          {/* 5. Limitation of Liability */}
          <section>
            <Text variant="h5" as="h2" className="mb-r5">
              5. Limitation of Liability
            </Text>
            <Text variant="body-1" color="secondary">
              In no event shall the developer be liable for any indirect, incidental, special,
              consequential, or punitive damages, including loss of profits, data, or use, arising
              out of or in connection with your use of the Service, even if advised of the
              possibility of such damages.
            </Text>
          </section>

          {/* 6. Acceptable Use */}
          <section>
            <Text variant="h5" as="h2" className="mb-r5">
              6. Acceptable Use
            </Text>
            <Text variant="body-1" color="secondary">
              You agree not to use the Service for any illegal activities, to upload malicious code,
              to harass or harm other users, or to interfere with the hosting infrastructure. The
              developer reserves the right to suspend or terminate your account at any time, with or
              without notice, for any reason — including but not limited to violation of these Terms,
              abusive behavior, excessive use that incurs significant costs, or any activity the
              developer reasonably considers harmful to the Service or its users. Upon termination,
              your right to use the Service ceases immediately.
            </Text>
          </section>

          {/* 7. Indemnification */}
          <section>
            <Text variant="h5" as="h2" className="mb-r5">
              7. Indemnification
            </Text>
            <Text variant="body-1" color="secondary">
              You agree to indemnify and hold harmless the developer from any claims, damages, losses,
              or expenses (including reasonable legal fees) arising out of your use of the Service,
              your violation of these Terms, or any activity conducted through your account. This
              includes, but is not limited to, any illegal, unauthorized, or harmful activity
              performed using the Service. The developer does not monitor user activity and bears no
              responsibility for how individual users choose to use the Service.
            </Text>
          </section>

          {/* 8. Self-Hosting */}
          <section>
            <Text variant="h5" as="h2" className="mb-r5">
              8. Self-Hosting
            </Text>
            <Text variant="body-1" color="secondary">
              This Service is open-source. Users are encouraged to self-host the software for full
              control over their data. The developer provides no support or liability for third-party
              self-hosted instances.
            </Text>
          </section>
        </Stack>
      </div>
    </div>
  );
}

export default Terms;

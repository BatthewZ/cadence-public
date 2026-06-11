import { escapeHtml } from "./utils";

/**
 * Security-notification email sent when a webhook subscription is created
 * on a workspace.
 *
 * ## Why this template exists
 *
 * A webhook subscription is an outbound data-exfiltration pipe by design:
 * every matching event is signed and pushed to a URL the caller chose. A
 * compromised session or compromised PAT can register a webhook pointing
 * at attacker-controlled infrastructure and then silently observe the
 * workspace's activity for the lifetime of the credential. The audit
 * ledger captures the registration after the fact, but for the workspace
 * owner / token owner the FIRST signal they need is an out-of-band email
 * — exactly the way GitHub, Stripe, and Linear notify on new webhook
 * registrations.
 *
 * The template surfaces:
 *  - **URL** — so a recipient can spot an unfamiliar destination
 *    immediately. We display it as text (not as a clickable link) to
 *    avoid making the email itself an exfiltration vector if a phishing
 *    URL slips into a token name.
 *  - **Events** — the data classes this webhook will see; an unexpected
 *    breadth (e.g. all task events for a confidential project) is a
 *    second signal.
 *  - **Project scope** — `null` for workspace-wide, or the project name
 *    when scoped. Workspace-wide is the higher-risk grant; the email
 *    should make that distinction visible.
 *  - **Created via** — `cookie session` or `API token "<name>"` so the
 *    recipient can correlate against their integrations. This is the
 *    single most important field for triage: a webhook created by an
 *    API token they don't recognise is the unambiguous "revoke now"
 *    signal.
 *
 * HTML-escapes every interpolated value because webhook names, project
 * names, and token names are user-controlled.
 */
export function webhookCreatedEmail(options: {
  recipientName: string;
  workspaceName: string;
  webhookName: string;
  webhookUrl: string;
  events: string[];
  projectName: string | null;
  createdVia: { kind: "cookie" } | { kind: "pat"; tokenName: string };
  createdAt: Date;
  settingsUrl: string;
}): { subject: string; html: string; text: string } {
  const {
    recipientName,
    workspaceName,
    webhookName,
    webhookUrl,
    events,
    projectName,
    createdVia,
    createdAt,
    settingsUrl,
  } = options;

  const safeRecipientName = escapeHtml(recipientName);
  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeWebhookName = escapeHtml(webhookName);
  const safeWebhookUrl = escapeHtml(webhookUrl);
  const safeSettingsUrl = escapeHtml(settingsUrl);
  const safeCreatedAt = escapeHtml(createdAt.toUTCString());
  const eventsSummary = events.length > 0 ? events.join(", ") : "no events";
  const safeEventsSummary = escapeHtml(eventsSummary);
  const safeScope = escapeHtml(
    projectName ? `Project: ${projectName}` : "Workspace-wide (all matching events)",
  );
  const safeCreatedVia =
    createdVia.kind === "cookie"
      ? "a browser session"
      : `the API token "${escapeHtml(createdVia.tokenName)}"`;

  const subject = "A new webhook was created on your Cadence workspace";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f7;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 40px 48px 16px 48px;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #1a1a2e; line-height: 1.3;">
                A new webhook was created
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 16px 48px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #51545e;">
                Hi ${safeRecipientName}, a webhook subscription was just created on the workspace <strong>${safeWorkspaceName}</strong>. Every matching event will be signed and delivered to the URL below.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 24px 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fc; border: 1px solid #eaeaec; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.4; color: #6b6e76; text-transform: uppercase; letter-spacing: 0.04em;">
                      Webhook name
                    </p>
                    <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.5; color: #1a1a2e; font-weight: 600;">
                      ${safeWebhookName}
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.4; color: #6b6e76; text-transform: uppercase; letter-spacing: 0.04em;">
                      Destination URL
                    </p>
                    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.5; color: #1a1a2e; font-family: 'SF Mono', Menlo, monospace; word-break: break-all;">
                      ${safeWebhookUrl}
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.4; color: #6b6e76; text-transform: uppercase; letter-spacing: 0.04em;">
                      Scope
                    </p>
                    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.5; color: #1a1a2e;">
                      ${safeScope}
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.4; color: #6b6e76; text-transform: uppercase; letter-spacing: 0.04em;">
                      Events
                    </p>
                    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.5; color: #1a1a2e; font-family: 'SF Mono', Menlo, monospace; word-break: break-word;">
                      ${safeEventsSummary}
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.4; color: #6b6e76; text-transform: uppercase; letter-spacing: 0.04em;">
                      Created via
                    </p>
                    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.5; color: #1a1a2e;">
                      ${safeCreatedVia}
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.4; color: #6b6e76; text-transform: uppercase; letter-spacing: 0.04em;">
                      Created
                    </p>
                    <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #1a1a2e;">
                      ${safeCreatedAt}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 24px 48px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.5; color: #51545e;">
                If you created this webhook, no action is required. If you don't recognise the destination URL or the token that created it, revoke the webhook (and the token) immediately.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 32px 48px;" align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius: 6px; background-color: #3869d4;">
                    <a href="${safeSettingsUrl}" target="_blank" style="display: inline-block; padding: 12px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 6px;">
                      Review webhooks
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 48px; background-color: #f4f4f7; border-top: 1px solid #eaeaec;">
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9a9ea6; text-align: center;">
                You received this email because a webhook was created on a Cadence workspace you belong to.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `A new webhook was created on your Cadence workspace

Hi ${recipientName}, a webhook subscription was just created on the workspace ${workspaceName}. Every matching event will be signed and delivered to the URL below.

Webhook name:    ${webhookName}
Destination URL: ${webhookUrl}
Scope:           ${projectName ? `Project: ${projectName}` : "Workspace-wide"}
Events:          ${eventsSummary}
Created via:     ${createdVia.kind === "cookie" ? "a browser session" : `the API token "${createdVia.tokenName}"`}
Created:         ${createdAt.toUTCString()}

If you created this webhook, no action is required.

If you don't recognise the destination URL or the token that created it, revoke the webhook (and the token) immediately:
${settingsUrl}
`;

  return { subject, html, text };
}

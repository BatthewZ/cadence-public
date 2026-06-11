import { escapeHtml } from "./utils";

/**
 * Security-notification email sent whenever a Personal Access Token is minted
 * on a user's account.
 *
 * ## Why this template exists
 *
 * API tokens are long-lived bearer credentials with the same blast radius as
 * the underlying user's workspace membership. If an attacker compromises a
 * session, the very first thing they will do is mint a PAT so they can keep
 * access even after the cookie is rotated. The creation email is the
 * legitimate user's only out-of-band signal that this happened — without it
 * an attacker's pivot is silent.
 *
 * The template intentionally:
 *  - Surfaces the token's `name`, the workspace, the timestamp, and the
 *    scopes the token was granted, so the recipient can recognize an
 *    unfamiliar token at a glance.
 *  - Links to the settings page so revocation is one click away.
 *  - Uses neutral subject copy ("A new API token was created") rather than
 *    alarmist phrasing — false positives erode trust in the signal.
 *  - HTML-escapes every interpolated value because token names and workspace
 *    names are user-controlled.
 */
export function apiTokenCreatedEmail(options: {
  recipientName: string;
  tokenName: string;
  workspaceName: string;
  scopes: string[];
  createdAt: Date;
  settingsUrl: string;
}): { subject: string; html: string; text: string } {
  const { recipientName, tokenName, workspaceName, scopes, createdAt, settingsUrl } = options;

  const safeTokenName = escapeHtml(tokenName);
  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeRecipientName = escapeHtml(recipientName);
  const safeSettingsUrl = escapeHtml(settingsUrl);
  const safeCreatedAt = escapeHtml(createdAt.toUTCString());
  const scopesSummary = scopes.length > 0 ? scopes.join(", ") : "no scopes";
  const safeScopesSummary = escapeHtml(scopesSummary);

  const subject = "A new API token was created on your Cadence account";

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
                A new API token was created
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 16px 48px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #51545e;">
                Hi ${safeRecipientName}, we're letting you know that a new API token was just generated on your Cadence account.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 24px 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fc; border: 1px solid #eaeaec; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.4; color: #6b6e76; text-transform: uppercase; letter-spacing: 0.04em;">
                      Token name
                    </p>
                    <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.5; color: #1a1a2e; font-weight: 600;">
                      ${safeTokenName}
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.4; color: #6b6e76; text-transform: uppercase; letter-spacing: 0.04em;">
                      Workspace
                    </p>
                    <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.5; color: #1a1a2e;">
                      ${safeWorkspaceName}
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.4; color: #6b6e76; text-transform: uppercase; letter-spacing: 0.04em;">
                      Scopes
                    </p>
                    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.5; color: #1a1a2e; font-family: 'SF Mono', Menlo, monospace; word-break: break-word;">
                      ${safeScopesSummary}
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
                If you created this token, no action is required. If you don't recognise it, revoke it right away and rotate your password.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 32px 48px;" align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius: 6px; background-color: #3869d4;">
                    <a href="${safeSettingsUrl}" target="_blank" style="display: inline-block; padding: 12px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 6px;">
                      Review API tokens
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 48px; background-color: #f4f4f7; border-top: 1px solid #eaeaec;">
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9a9ea6; text-align: center;">
                You received this email because a new API token was created on your Cadence account.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `A new API token was created on your Cadence account

Hi ${recipientName}, we're letting you know that a new API token was just generated on your Cadence account.

Token name: ${tokenName}
Workspace:  ${workspaceName}
Scopes:     ${scopesSummary}
Created:    ${createdAt.toUTCString()}

If you created this token, no action is required.

If you don't recognise it, revoke it right away and rotate your password:
${settingsUrl}
`;

  return { subject, html, text };
}

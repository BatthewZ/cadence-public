import { escapeHtml } from "./utils";

/**
 * Security-notification email sent whenever a Personal Access Token is
 * rotated.
 *
 * ## Why this template exists
 *
 * Rotation produces a brand-new plaintext credential under the same name
 * and scopes as the original. From a security-detection perspective it is
 * indistinguishable from a mint — if an attacker has compromised the
 * session that minted the original token, rotating that token is the
 * cheapest way for them to obtain a long-lived bearer that survives a
 * cookie reset. The owner needs to hear about every new plaintext via a
 * channel they control.
 *
 * The template intentionally:
 *  - Shows the old token's display prefix so a recipient who has many
 *    tokens can correlate the event against their integration logs.
 *  - Surfaces the `revokeAt` date so the recipient knows when the
 *    grace window closes and the old plaintext stops working — this is
 *    operational information they need to roll the secret cleanly.
 *  - Links to the settings page so an emergency revocation is one click
 *    away if the rotation was unexpected.
 *  - HTML-escapes every interpolated value because token names and
 *    workspace names are user-controlled.
 */
export function apiTokenRotatedEmail(options: {
  recipientName: string;
  tokenName: string;
  workspaceName: string;
  rotatedAt: Date;
  oldTokenPrefix: string;
  revokeAt: Date;
  settingsUrl: string;
}): { subject: string; html: string; text: string } {
  const {
    recipientName,
    tokenName,
    workspaceName,
    rotatedAt,
    oldTokenPrefix,
    revokeAt,
    settingsUrl,
  } = options;

  const safeTokenName = escapeHtml(tokenName);
  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeRecipientName = escapeHtml(recipientName);
  const safeSettingsUrl = escapeHtml(settingsUrl);
  const safeRotatedAt = escapeHtml(rotatedAt.toUTCString());
  const safeOldTokenPrefix = escapeHtml(oldTokenPrefix);
  const safeRevokeAt = escapeHtml(revokeAt.toUTCString());

  const subject = "An API token on your Cadence account was rotated";

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
                An API token was rotated
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 16px 48px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #51545e;">
                Hi ${safeRecipientName}, a Personal Access Token on your Cadence account was just rotated. A new plaintext credential was generated and the previous token will stop working at the end of its grace window.
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
                      Previous token prefix
                    </p>
                    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.5; color: #1a1a2e; font-family: 'SF Mono', Menlo, monospace;">
                      ${safeOldTokenPrefix}…
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.4; color: #6b6e76; text-transform: uppercase; letter-spacing: 0.04em;">
                      Rotated
                    </p>
                    <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.5; color: #1a1a2e;">
                      ${safeRotatedAt}
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.4; color: #6b6e76; text-transform: uppercase; letter-spacing: 0.04em;">
                      Old token revokes at
                    </p>
                    <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #1a1a2e;">
                      ${safeRevokeAt}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 24px 48px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.5; color: #51545e;">
                If you rotated this token, no action is required. If you don't recognise this rotation, revoke both tokens immediately and rotate your password.
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
                You received this email because a Personal Access Token on your Cadence account was rotated.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `An API token on your Cadence account was rotated

Hi ${recipientName}, a Personal Access Token on your Cadence account was just rotated. A new plaintext credential was generated and the previous token will stop working at the end of its grace window.

Token name:              ${tokenName}
Workspace:               ${workspaceName}
Previous token prefix:   ${oldTokenPrefix}…
Rotated:                 ${rotatedAt.toUTCString()}
Old token revokes at:    ${revokeAt.toUTCString()}

If you rotated this token, no action is required.

If you don't recognise this rotation, revoke both tokens immediately and rotate your password:
${settingsUrl}
`;

  return { subject, html, text };
}

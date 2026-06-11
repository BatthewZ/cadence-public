import { escapeHtml } from "./utils";

/**
 * Security-notification email sent whenever a Personal Access Token is
 * revoked.
 *
 * ## Why this template exists
 *
 * Revocation kills a live credential. The owner needs to know — even if
 * they did not initiate the revocation themselves — because:
 *
 *  - If their integration suddenly stops working, the email is the
 *    fastest answer to "why?". Without it, an owner watching a CI job
 *    fail at 3 a.m. has no idea their token was killed by an admin
 *    twenty minutes earlier.
 *  - If they did NOT revoke and an admin did, that's a security event
 *    they should be aware of (likely something on their machine
 *    triggered it). The email tells them to investigate.
 *  - If they did NOT revoke and no admin did either, that's a more
 *    serious event — the email gives them a paper trail.
 *
 * The template:
 *  - Tells the owner unambiguously which token died.
 *  - Says "by an administrator" when an admin (not the owner) did it,
 *    without naming the admin — naming creates a needless human-on-human
 *    conflict surface; the actor's identity lives in the audit ledger.
 *  - Links to the settings page so the owner can mint a replacement
 *    without hunting for the UI.
 *  - HTML-escapes every interpolated value because token names and
 *    workspace names are user-controlled.
 */
export function apiTokenRevokedEmail(options: {
  recipientName: string;
  tokenName: string;
  workspaceName: string;
  revokedAt: Date;
  revokedByAdmin: boolean;
  settingsUrl: string;
}): { subject: string; html: string; text: string } {
  const {
    recipientName,
    tokenName,
    workspaceName,
    revokedAt,
    revokedByAdmin,
    settingsUrl,
  } = options;

  const safeTokenName = escapeHtml(tokenName);
  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeRecipientName = escapeHtml(recipientName);
  const safeSettingsUrl = escapeHtml(settingsUrl);
  const safeRevokedAt = escapeHtml(revokedAt.toUTCString());

  const subject = "An API token on your Cadence account was revoked";

  const initiatorLine = revokedByAdmin
    ? "This revocation was initiated by a workspace administrator. If you were not expecting this, please contact your workspace owner."
    : "If you revoked this token, no action is required.";

  const safeInitiatorLine = escapeHtml(initiatorLine);

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
                An API token was revoked
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 16px 48px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #51545e;">
                Hi ${safeRecipientName}, a Personal Access Token on your Cadence account has been revoked and can no longer authenticate API requests.
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
                      Revoked
                    </p>
                    <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #1a1a2e;">
                      ${safeRevokedAt}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 24px 48px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.5; color: #51545e;">
                ${safeInitiatorLine}
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
                You received this email because a Personal Access Token on your Cadence account was revoked.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `An API token on your Cadence account was revoked

Hi ${recipientName}, a Personal Access Token on your Cadence account has been revoked and can no longer authenticate API requests.

Token name:  ${tokenName}
Workspace:   ${workspaceName}
Revoked:     ${revokedAt.toUTCString()}

${initiatorLine}

Review your API tokens here:
${settingsUrl}
`;

  return { subject, html, text };
}

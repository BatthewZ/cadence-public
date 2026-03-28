import { escapeHtml } from "./utils";

export function passwordResetEmail(options: {
  url: string;
  expiresInMinutes?: number;
}): { subject: string; html: string; text: string } {
  const { url, expiresInMinutes = 60 } = options;
  const safeUrl = escapeHtml(url);

  const subject = "Reset your password";

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
          <!-- Header -->
          <tr>
            <td style="padding: 40px 48px 24px 48px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #1a1a2e; line-height: 1.3;">
                Reset your password
              </h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 0 48px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #51545e;">
                We received a request to reset your password. Click the button below to choose a new one. This link will expire in ${escapeHtml(String(expiresInMinutes))} minutes.
              </p>
            </td>
          </tr>
          <!-- Button -->
          <tr>
            <td style="padding: 24px 48px;" align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius: 6px; background-color: #3869d4;">
                    <a href="${safeUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 6px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Fallback link -->
          <tr>
            <td style="padding: 0 48px;">
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.5; color: #6b6e76;">
                If the button above doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.5; color: #3869d4; word-break: break-all;">
                ${safeUrl}
              </p>
            </td>
          </tr>
          <!-- Security notice -->
          <tr>
            <td style="padding: 0 48px 40px 48px;">
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #6b6e76;">
                If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 48px; background-color: #f4f4f7; border-top: 1px solid #eaeaec;">
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9a9ea6; text-align: center;">
                You received this email because a password reset was requested for your account.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Reset your password

We received a request to reset your password. Use the link below to choose a new one. This link will expire in ${expiresInMinutes} minutes.

Reset your password: ${url}

If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.`;

  return { subject, html, text };
}

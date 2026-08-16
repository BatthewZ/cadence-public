/**
 * Out-of-band security notification helpers for webhook lifecycle events.
 *
 * Why this lives in its own file:
 *  - Both the workspace-scoped webhook handler
 *    (`src/api/routes/webhooks/webhooks.handlers.ts`) and the project-
 *    scoped webhook handler (`src/api/routes/projects/project-webhooks.handlers.ts`)
 *    need to ship an identical security email when a webhook is created.
 *    Duplicating the wiring (env lookup, recipient resolution, template
 *    composition, deferWork wrapping) in both places is the exact kind of
 *    surface that drifts silently — one handler grows a field and the
 *    other forgets, and the security signal degrades.
 *  - Centralising the helper also gives us one obvious place to add
 *    rotation / disable / regenerate-secret notifications later without
 *    multiplying the touch points.
 *
 * The helper is `deferWork`-based, so a slow Resend response (or a
 * console-logged email in self-hosted installs without a Resend key) can
 * never block the API response. Errors are logged but never propagated:
 * the email is a security signal, not a hard requirement of the request.
 */

import { eq } from "drizzle-orm";
import type { Context } from "hono";

import { user as schemaUser } from "../../../db/schema";
import { project } from "../../../db/schema/project";
import { workspace } from "../../../db/schema/workspace";
import type { AppEnv } from "../../env";
import { deferWork } from "../defer";
import { createEmailService } from "../email";
// From the leaf module, not the `../email` barrel — see `../email/from.ts`.
import { resolveEmailFrom } from "../email/from";
import { webhookCreatedEmail } from "../email/templates/webhook-created";

/**
 * Notify the actor (cookie user or PAT owner) that a webhook was created
 * on `workspaceId`. The actor is always the human responsible for the
 * credential the request arrived under — for cookie sessions that's
 * `c.get("user")`; for PATs we walk back to the token's `userId` (which
 * is the same human as `c.get("user")` because the auth middleware
 * bridges the PAT into the same user slot, but we resolve it explicitly
 * for clarity).
 *
 * Scheduling is fire-and-forget via `deferWork`. The handler that calls
 * this returns immediately; the email is shipped after the response.
 */
export function scheduleWebhookCreatedEmail(
  c: Context<AppEnv>,
  args: {
    workspaceId: string;
    webhookName: string;
    webhookUrl: string;
    events: string[];
    projectId: string | null;
    createdAt: Date;
  },
): void {
  deferWork(c, async () => {
    try {
      const db = c.get("db");
      const env = c.env;
      const user = c.get("user");
      if (!user) {
        // No actor → no recipient. Should never happen on a successful
        // create (the route requires auth), but we guard so the audit
        // surface never sends mail to an unknown address.
        return;
      }

      // Resolve workspace name + (optional) project name for the email
      // body. Both are user-visible identifiers — null-coalesce so the
      // text never says "undefined".
      const [[ws], projectRow] = await Promise.all([
        db.select({ name: workspace.name }).from(workspace).where(eq(workspace.id, args.workspaceId)).limit(1),
        args.projectId
          ? db.select({ name: project.name }).from(project).where(eq(project.id, args.projectId)).limit(1)
          : Promise.resolve<{ name: string }[]>([]),
      ]);
      const workspaceName = ws?.name ?? "your workspace";
      const projectName = args.projectId ? (projectRow[0]?.name ?? null) : null;

      // Determine the actor / "createdVia" label. PAT-attributed creates
      // surface the token NAME (not id) so the recipient can correlate
      // against their integration inventory — "Slackbot prod" is far
      // more actionable than "tok_a4kZ…".
      const token = c.get("apiToken");
      const createdVia: { kind: "cookie" } | { kind: "pat"; tokenName: string } = token
        ? { kind: "pat", tokenName: token.name }
        : { kind: "cookie" };

      // Look up the recipient's display name. `c.get("user")` already
      // carries it for cookie auth, but the PAT bridge fills a
      // better-auth shape that may have a different name source — read
      // from the DB to be safe.
      const [recipient] = await db
        .select({ name: schemaUser.name, email: schemaUser.email })
        .from(schemaUser)
        .where(eq(schemaUser.id, user.id))
        .limit(1);
      const recipientName = recipient?.name ?? user.name ?? "there";
      const recipientEmail = recipient?.email ?? user.email;
      if (!recipientEmail) return;

      const emailService = createEmailService({
        RESEND_API_KEY: env.RESEND_API_KEY,
        EMAIL_FROM: env.EMAIL_FROM,
      });
      const baseUrl = env.BETTER_AUTH_URL?.replace(/\/+$/, "") ?? "";
      const settingsUrl = `${baseUrl}/settings/webhooks`;

      const { subject, html, text } = webhookCreatedEmail({
        recipientName,
        workspaceName,
        webhookName: args.webhookName,
        webhookUrl: args.webhookUrl,
        events: args.events,
        projectName,
        createdVia,
        createdAt: args.createdAt,
        settingsUrl,
      });

      await emailService.send({
        to: recipientEmail,
        from: resolveEmailFrom(env),
        subject,
        html,
        text,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          lib: "webhooks/notify",
          op: "scheduleWebhookCreatedEmail",
          workspaceId: args.workspaceId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
}

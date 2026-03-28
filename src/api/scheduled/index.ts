import { createDb } from "../../db";
import type { AppBindings } from "../env";
import { processWebhookRetries } from "../lib/webhooks";
import { cleanupAuthTables } from "./auth-cleanup";
import { cleanupInvitations } from "./invitation-cleanup";
import { cleanupNotifications } from "./notification-cleanup";
import { cleanupTaskActivity } from "./task-activity-cleanup";
import { cleanupWebhookDeliveries } from "./webhook-cleanup";

/**
 * Cloudflare Workers scheduled (cron) handler.
 *
 * Runs every 5 minutes via the `[triggers] crons` configuration in
 * `wrangler.toml`. Performs background maintenance tasks that must not block
 * user-facing HTTP requests:
 *
 * 1. **Webhook retries** -- Re-attempts failed webhook deliveries whose
 *    exponential backoff timer has elapsed (batch of 10 to stay within
 *    free-tier CPU budget).
 * 2. **Delivery cleanup** -- Removes webhook delivery records older than
 *    30 days and enforces a per-webhook cap of 200 records.
 * 3. **Auth cleanup** -- Removes expired sessions and abandoned verification
 *    tokens that Better Auth does not clean up automatically.
 * 4. **Notification cleanup** -- Removes read notifications older than 30
 *    days and unread notifications older than 90 days.
 * 5. **Task activity cleanup** -- Removes activity records older than 90
 *    days and enforces a per-task cap of 500 records.
 * 6. **Invitation cleanup** -- Removes non-pending expired invitations and
 *    pending invitations expired beyond a 7-day grace period.
 */
export async function handleScheduled(
  _event: ScheduledEvent,
  env: AppBindings,
): Promise<void> {
  const db = createDb(env.DB);

  // Process pending webhook retries (batch of 10, stays within free tier CPU)
  const retriesProcessed = await processWebhookRetries(db);
  if (retriesProcessed > 0) {
    console.log(`[scheduled] Processed ${retriesProcessed} webhook retries`);
  }

  // Clean up old webhook deliveries (30-day retention + per-webhook cap)
  const cleaned = await cleanupWebhookDeliveries(db);
  if (cleaned > 0) {
    console.log(`[scheduled] Cleaned up ${cleaned} old webhook deliveries`);
  }

  // Clean up expired sessions and abandoned verification tokens
  const authCleaned = await cleanupAuthTables(db);
  if (authCleaned > 0) {
    console.log(`[scheduled] Cleaned up ${authCleaned} expired auth records`);
  }

  // Clean up old notifications (30-day read, 90-day unread retention)
  const notifCleaned = await cleanupNotifications(db);
  if (notifCleaned > 0) {
    console.log(`[scheduled] Cleaned up ${notifCleaned} old notifications`);
  }

  // Clean up old task activity records (90-day retention + per-task cap)
  const activityCleaned = await cleanupTaskActivity(db);
  if (activityCleaned > 0) {
    console.log(
      `[scheduled] Cleaned up ${activityCleaned} old task activity records`,
    );
  }

  // Clean up expired invitations (accepted/revoked + pending with grace period)
  const invitationCleaned = await cleanupInvitations(db);
  if (invitationCleaned > 0) {
    console.log(
      `[scheduled] Cleaned up ${invitationCleaned} expired invitations`,
    );
  }
}

import { createDb } from "../../db";
import type { AppBindings } from "../env";
import { createTelemetrySink } from "../lib/telemetry";
import type { TelemetrySink } from "../lib/telemetry/types";
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
 *    exponential backoff timer has elapsed (batch of 50 with jitter to
 *    prevent thundering herd).
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
/** Run a cleanup task, logging results. Catches so one failure doesn't block the rest. */
async function runTask(name: string, fn: () => Promise<number>, sink?: TelemetrySink): Promise<{ success: boolean }> {
  const start = Date.now();
  try {
    const count = await fn();
    if (count > 0) {
      console.log(`[scheduled] ${name}: ${count}`);
    }
    sink?.track({
      type: "cron_task",
      taskName: name,
      durationMs: Date.now() - start,
      count,
      success: true,
    });
    return { success: true };
  } catch (error) {
    console.error(`[scheduled] ${name} failed:`, error);
    sink?.track({
      type: "cron_task",
      taskName: name,
      durationMs: Date.now() - start,
      count: 0,
      success: false,
    });
    return { success: false };
  }
}

export async function handleScheduled(
  _event: ScheduledEvent,
  env: AppBindings,
): Promise<void> {
  const db = createDb(env.DB);
  const sink = createTelemetrySink(env);
  const cronStart = Date.now();
  let tasksRun = 0;
  let errors = 0;

  const track = async (name: string, fn: () => Promise<number>) => {
    const result = await runTask(name, fn, sink);
    tasksRun++;
    if (!result.success) errors++;
  };

  await track("Processed webhook retries", () => processWebhookRetries(db, sink));
  await track("Cleaned up old webhook deliveries", () => cleanupWebhookDeliveries(db));
  await track("Cleaned up expired auth records", () => cleanupAuthTables(db));
  await track("Cleaned up old notifications", () => cleanupNotifications(db));
  await track("Cleaned up old task activity records", () => cleanupTaskActivity(db));
  await track("Cleaned up expired invitations", () => cleanupInvitations(db));

  sink.track({
    type: "cron_run",
    durationMs: Date.now() - cronStart,
    tasksRun,
    errors,
  });

  await sink.flush();
}

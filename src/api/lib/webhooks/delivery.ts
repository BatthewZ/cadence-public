import { and, eq, lt, lte, sql } from "drizzle-orm";

import type { Database } from "../../../db";
import { webhook, webhookDelivery } from "../../../db/schema/webhook";
import type { WebhookEventType } from "../../../shared/types/webhook";
import type { TelemetrySink } from "../telemetry/types";
import type { WebhookDeliveryEvent, WebhookRetryEvent } from "../telemetry/types";
import { signPayload, type WebhookRow } from "./utils";

// ---------------------------------------------------------------------------
// Telemetry helper — shared by initial delivery and retry paths.
// ---------------------------------------------------------------------------

function trackDeliveryTelemetry(
  sink: TelemetrySink | undefined,
  type: "webhook_delivery" | "webhook_retry",
  webhookRow: WebhookRow,
  deliveryId: string,
  event: string,
  opts: { success: boolean; statusCode: number | null; durationMs: number; attempt: number },
): void {
  if (!sink) return;
  const data = {
    webhookId: webhookRow.id,
    deliveryId,
    event,
    ...opts,
    workspaceId: webhookRow.workspaceId,
  };
  // Branch on the discriminator so TypeScript narrows to the exact event variant.
  if (type === "webhook_delivery") {
    sink.track({ type, ...data } satisfies WebhookDeliveryEvent);
  } else {
    sink.track({ type, ...data } satisfies WebhookRetryEvent);
  }
}

// ---------------------------------------------------------------------------
// Backoff schedule: maps attempt number to delay in seconds
// Attempt 1 is the initial delivery (immediate), retries start at attempt 2.
// ---------------------------------------------------------------------------

const BACKOFF_SCHEDULE: Record<number, number> = {
  2: 60,
  3: 300,
  4: 1800,
  5: 7200,
};

const MAX_ATTEMPTS = 5;
const AUTO_DISABLE_THRESHOLD = 10;
const DELIVERY_TIMEOUT_MS = 10_000;
const RETRY_BATCH_LIMIT = 50;

/**
 * HTTP status codes that indicate a permanent configuration or authentication
 * problem on the receiver's side. Retrying these is wasteful because the
 * error will not resolve without human intervention (e.g. fixing the secret,
 * correcting the endpoint URL, or allowlisting the request method).
 */
const NON_RETRYABLE_STATUS_CODES = new Set([
  401, // Unauthorized — bad/missing secret or auth token
  403, // Forbidden — receiver explicitly rejects the request
  404, // Not Found — endpoint does not exist
  405, // Method Not Allowed — receiver does not accept POST
  410, // Gone — endpoint has been permanently removed
]);

/** Returns true when the status code indicates a permanent receiver-side problem. */
function isNonRetryable(statusCode: number | null): boolean {
  return statusCode !== null && NON_RETRYABLE_STATUS_CODES.has(statusCode);
}

/** Apply +/- 20% random jitter to a backoff delay to prevent thundering herd. */
function applyJitter(seconds: number): number {
  const jitter = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
  return Math.round(seconds * jitter);
}

// ---------------------------------------------------------------------------
// dispatchWebhookEvent
// ---------------------------------------------------------------------------

/**
 * Fan-out a webhook event to all active subscriptions in a workspace.
 *
 * Uses `executionCtx.waitUntil()` so delivery happens asynchronously
 * after the HTTP response, matching the non-blocking pattern used for
 * notifications. This ensures webhook delivery never blocks the user's
 * request — failures are recorded in the `webhookDelivery` table and
 * retried by the cron handler.
 *
 * @returns The number of matching webhooks that were dispatched.
 */
export async function dispatchWebhookEvent(
  db: Database,
  executionCtx: ExecutionContext,
  workspaceId: string,
  event: WebhookEventType,
  payload: Record<string, unknown>,
  projectId?: string | null,
  sink?: TelemetrySink,
): Promise<number> {
  try {
    // Use Drizzle select with raw SQL for json_each() to match webhooks
    // subscribed to this event. D1 supports SQLite JSON functions.
    //
    // Project scoping rules:
    // - Workspace-level webhooks (projectId IS NULL) always fire for all events.
    // - Project-scoped webhooks only fire when the event's projectId matches.
    // - Workspace-scoped events (no projectId in the dispatch call) only reach
    //   workspace-level webhooks.
    const projectFilter = projectId
      ? sql`(${webhook.projectId} IS NULL OR ${webhook.projectId} = ${projectId})`
      : sql`${webhook.projectId} IS NULL`;

    const rows = await db
      .select()
      .from(webhook)
      .where(
        and(
          eq(webhook.workspaceId, workspaceId),
          eq(webhook.active, true),
          sql`EXISTS (SELECT 1 FROM json_each(${webhook.events}) je WHERE je.value = ${event})`,
          projectFilter,
        ),
      );

    if (rows.length === 0) {
      return 0;
    }

    for (const row of rows) {
      const deliveryId = crypto.randomUUID();
      executionCtx.waitUntil(deliverWebhook(db, row, deliveryId, event, payload, sink));
    }

    return rows.length;
  } catch (error) {
    console.error("[webhooks] Failed to dispatch event", event, error);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// deliverWebhook
// ---------------------------------------------------------------------------

/**
 * Deliver a single webhook payload and record the result.
 *
 * Builds the full {@link WebhookPayloadEnvelope}-shaped body, signs it with
 * HMAC-SHA256, and POSTs to the endpoint with standard webhook headers.
 *
 * On failure the delivery record is updated with exponential backoff timing
 * so the cron-based retry processor can re-attempt later. After
 * {@link AUTO_DISABLE_THRESHOLD} consecutive failures the webhook is
 * automatically disabled to prevent wasted requests against a permanently
 * broken endpoint.
 *
 * This function is designed to never throw — all errors are caught and
 * recorded so that it is safe to pass directly to `waitUntil()`.
 */
export async function deliverWebhook(
  db: Database,
  webhookRow: WebhookRow,
  deliveryId: string,
  event: WebhookEventType,
  payload: Record<string, unknown>,
  sink?: TelemetrySink,
): Promise<void> {
  const now = new Date();
  const timestampSeconds = Math.floor(now.getTime() / 1000).toString();

  // Build the envelope body with the delivery ID embedded.
  const envelope = { ...payload, id: deliveryId };

  const payloadString = JSON.stringify(envelope);
  const fetchStart = Date.now();

  try {
    const signature = await signPayload(payloadString, webhookRow.secret);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(webhookRow.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": `sha256=${signature}`,
          "X-Webhook-Event": event,
          "X-Webhook-Delivery-Id": deliveryId,
          "X-Webhook-Timestamp": timestampSeconds,
          "User-Agent": "Cadence-Webhooks/1.0",
        },
        body: payloadString,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const responseBody = await response.text().catch(() => "");
    const success = response.status >= 200 && response.status < 300;
    const durationMs = Date.now() - fetchStart;

    trackDeliveryTelemetry(sink, "webhook_delivery", webhookRow, deliveryId, event, {
      success, statusCode: response.status, durationMs, attempt: 1,
    });

    if (success) {
      // Record successful delivery
      await db.insert(webhookDelivery).values({
        id: deliveryId,
        webhookId: webhookRow.id,
        event,
        payload: payloadString,
        statusCode: response.status,
        response: responseBody.slice(0, 4096),
        success: true,
        attempts: 1,
        maxAttempts: MAX_ATTEMPTS,
        nextRetryAt: null,
        createdAt: now,
        lastAttemptAt: now,
      });

      // Reset consecutive failures on success
      await db
        .update(webhook)
        .set({ consecutiveFailures: 0, updatedAt: now })
        .where(eq(webhook.id, webhookRow.id));
    } else {
      // Non-2xx response — record failure with retry scheduling
      await recordDeliveryFailure(
        db,
        webhookRow,
        deliveryId,
        event,
        payloadString,
        response.status,
        responseBody.slice(0, 4096),
        1,
        now,
      );
    }
  } catch (error) {
    // Network error, timeout, or other fetch failure
    const durationMs = Date.now() - fetchStart;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown delivery error";

    trackDeliveryTelemetry(sink, "webhook_delivery", webhookRow, deliveryId, event, {
      success: false, statusCode: null, durationMs, attempt: 1,
    });

    try {
      await recordDeliveryFailure(
        db,
        webhookRow,
        deliveryId,
        event,
        payloadString,
        null,
        errorMessage.slice(0, 4096),
        1,
        now,
      );
    } catch (dbError) {
      console.error(
        "[webhooks] Failed to record delivery failure for",
        deliveryId,
        dbError,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// recordDeliveryFailure (internal)
// ---------------------------------------------------------------------------

/**
 * Record a failed delivery attempt with exponential backoff retry scheduling.
 *
 * Inserts a `webhookDelivery` row for the failed attempt and increments the
 * webhook's `consecutiveFailures` counter. When the counter reaches
 * {@link AUTO_DISABLE_THRESHOLD} the webhook is automatically deactivated.
 */
async function recordDeliveryFailure(
  db: Database,
  webhookRow: WebhookRow,
  deliveryId: string,
  event: string,
  payloadString: string,
  statusCode: number | null,
  responseText: string,
  attempt: number,
  now: Date,
): Promise<void> {
  const nonRetryable = isNonRetryable(statusCode);
  const nextAttempt = attempt + 1;
  const backoffSeconds = BACKOFF_SCHEDULE[nextAttempt];
  const hasMoreRetries =
    !nonRetryable && nextAttempt <= MAX_ATTEMPTS && backoffSeconds !== undefined;

  const nextRetryAt = hasMoreRetries
    ? new Date(now.getTime() + applyJitter(backoffSeconds) * 1000)
    : null;

  if (nonRetryable) {
    console.warn(
      `[webhooks] Delivery ${deliveryId} received non-retryable status ${statusCode} — skipping retries`,
    );
  }

  await db.insert(webhookDelivery).values({
    id: deliveryId,
    webhookId: webhookRow.id,
    event,
    payload: payloadString,
    statusCode,
    response: responseText,
    success: false,
    attempts: attempt,
    maxAttempts: nonRetryable ? attempt : MAX_ATTEMPTS,
    nextRetryAt,
    createdAt: now,
    lastAttemptAt: now,
  });

  const newFailureCount =
    (typeof webhookRow.consecutiveFailures === "number"
      ? webhookRow.consecutiveFailures
      : 0) + 1;

  const webhookUpdate: Record<string, unknown> = {
    consecutiveFailures: newFailureCount,
    updatedAt: now,
  };

  if (newFailureCount >= AUTO_DISABLE_THRESHOLD) {
    webhookUpdate.active = false;
    console.warn(
      `[webhooks] Auto-disabling webhook ${webhookRow.id} after ${newFailureCount} consecutive failures`,
    );
  }

  await db
    .update(webhook)
    .set(webhookUpdate)
    .where(eq(webhook.id, webhookRow.id));
}

// ---------------------------------------------------------------------------
// processWebhookRetries
// ---------------------------------------------------------------------------

/**
 * Process pending webhook delivery retries.
 *
 * Designed to run from a cron trigger, this function queries for failed
 * deliveries whose `nextRetryAt` has passed and re-attempts delivery.
 * The batch size is capped at {@link RETRY_BATCH_LIMIT} to stay within
 * Cloudflare Workers free-tier CPU budgets.
 *
 * @returns The number of retries processed.
 */
export async function processWebhookRetries(db: Database, sink?: TelemetrySink): Promise<number> {
  const now = new Date();

  try {
    // Find deliveries eligible for retry:
    // - Not yet successful
    // - Retry time has passed
    // - Under the max attempts limit
    const pendingRetries = await db
      .select({
        delivery: webhookDelivery,
        webhookUrl: webhook.url,
        webhookSecret: webhook.secret,
        webhookActive: webhook.active,
        webhookConsecutiveFailures: webhook.consecutiveFailures,
        webhookWorkspaceId: webhook.workspaceId,
        webhookProjectId: webhook.projectId,
        webhookName: webhook.name,
        webhookEvents: webhook.events,
        webhookCreatedAt: webhook.createdAt,
        webhookUpdatedAt: webhook.updatedAt,
      })
      .from(webhookDelivery)
      .innerJoin(webhook, eq(webhookDelivery.webhookId, webhook.id))
      .where(
        and(
          eq(webhookDelivery.success, false),
          lte(webhookDelivery.nextRetryAt, now),
          lt(webhookDelivery.attempts, webhookDelivery.maxAttempts),
        ),
      )
      .limit(RETRY_BATCH_LIMIT);

    let processedCount = 0;

    for (const row of pendingRetries) {
      // Skip inactive webhooks — no point retrying if manually or auto-disabled
      if (!row.webhookActive) {
        // Clear the retry marker so this delivery is not picked up again
        await db
          .update(webhookDelivery)
          .set({ nextRetryAt: null, lastAttemptAt: now })
          .where(eq(webhookDelivery.id, row.delivery.id));
        continue;
      }

      const webhookRow: WebhookRow = {
        id: row.delivery.webhookId,
        workspaceId: row.webhookWorkspaceId,
        projectId: row.webhookProjectId,
        name: row.webhookName,
        url: row.webhookUrl,
        secret: row.webhookSecret,
        events: row.webhookEvents,
        active: row.webhookActive,
        consecutiveFailures: row.webhookConsecutiveFailures,
        createdAt: row.webhookCreatedAt,
        updatedAt: row.webhookUpdatedAt,
      };

      await retryDelivery(db, webhookRow, row.delivery, now, sink);
      processedCount++;
    }

    return processedCount;
  } catch (error) {
    console.error("[webhooks] Failed to process retries", error);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// retryDelivery (internal)
// ---------------------------------------------------------------------------

/**
 * Re-attempt a single failed webhook delivery.
 *
 * Reads the original payload from the delivery record, signs and sends it,
 * then updates the delivery row with the outcome.
 */
async function retryDelivery(
  db: Database,
  webhookRow: WebhookRow,
  delivery: typeof webhookDelivery.$inferSelect,
  now: Date,
  sink?: TelemetrySink,
): Promise<void> {
  const attempt = delivery.attempts + 1;
  const timestampSeconds = Math.floor(now.getTime() / 1000).toString();
  const fetchStart = Date.now();

  try {
    const signature = await signPayload(delivery.payload, webhookRow.secret);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(webhookRow.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": `sha256=${signature}`,
          "X-Webhook-Event": delivery.event,
          "X-Webhook-Delivery-Id": delivery.id,
          "X-Webhook-Timestamp": timestampSeconds,
          "User-Agent": "Cadence-Webhooks/1.0",
        },
        body: delivery.payload,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const responseBody = await response.text().catch(() => "");
    const success = response.status >= 200 && response.status < 300;
    const durationMs = Date.now() - fetchStart;

    trackDeliveryTelemetry(sink, "webhook_retry", webhookRow, delivery.id, delivery.event, {
      success, statusCode: response.status, durationMs, attempt,
    });

    if (success) {
      await db
        .update(webhookDelivery)
        .set({
          success: true,
          statusCode: response.status,
          response: responseBody.slice(0, 4096),
          attempts: attempt,
          nextRetryAt: null,
          lastAttemptAt: now,
        })
        .where(eq(webhookDelivery.id, delivery.id));

      await db
        .update(webhook)
        .set({ consecutiveFailures: 0, updatedAt: now })
        .where(eq(webhook.id, webhookRow.id));
    } else {
      await updateDeliveryRetryFailure(
        db,
        webhookRow,
        delivery.id,
        attempt,
        response.status,
        responseBody.slice(0, 4096),
        now,
      );
    }
  } catch (error) {
    const durationMs = Date.now() - fetchStart;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown retry error";

    trackDeliveryTelemetry(sink, "webhook_retry", webhookRow, delivery.id, delivery.event, {
      success: false, statusCode: null, durationMs, attempt,
    });

    try {
      await updateDeliveryRetryFailure(
        db,
        webhookRow,
        delivery.id,
        attempt,
        null,
        errorMessage.slice(0, 4096),
        now,
      );
    } catch (dbError) {
      console.error(
        "[webhooks] Failed to update retry failure for",
        delivery.id,
        dbError,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// updateDeliveryRetryFailure (internal)
// ---------------------------------------------------------------------------

/**
 * Update a delivery record after a failed retry attempt and schedule the next
 * retry using exponential backoff.
 */
async function updateDeliveryRetryFailure(
  db: Database,
  webhookRow: WebhookRow,
  deliveryId: string,
  attempt: number,
  statusCode: number | null,
  responseText: string,
  now: Date,
): Promise<void> {
  const nonRetryable = isNonRetryable(statusCode);
  const nextAttemptNumber = attempt + 1;
  const backoffSeconds = BACKOFF_SCHEDULE[nextAttemptNumber];
  const hasMoreRetries =
    !nonRetryable && nextAttemptNumber <= MAX_ATTEMPTS && backoffSeconds !== undefined;

  const nextRetryAt = hasMoreRetries
    ? new Date(now.getTime() + applyJitter(backoffSeconds) * 1000)
    : null;

  if (nonRetryable) {
    console.warn(
      `[webhooks] Retry for delivery ${deliveryId} received non-retryable status ${statusCode} — stopping retries`,
    );
  }

  await db
    .update(webhookDelivery)
    .set({
      statusCode,
      response: responseText,
      attempts: attempt,
      maxAttempts: nonRetryable ? attempt : undefined,
      nextRetryAt,
      lastAttemptAt: now,
    })
    .where(eq(webhookDelivery.id, deliveryId));

  const newFailureCount =
    (typeof webhookRow.consecutiveFailures === "number"
      ? webhookRow.consecutiveFailures
      : 0) + 1;

  const webhookUpdate: Record<string, unknown> = {
    consecutiveFailures: newFailureCount,
    updatedAt: now,
  };

  if (newFailureCount >= AUTO_DISABLE_THRESHOLD) {
    webhookUpdate.active = false;
    console.warn(
      `[webhooks] Auto-disabling webhook ${webhookRow.id} after ${newFailureCount} consecutive failures`,
    );
  }

  await db
    .update(webhook)
    .set(webhookUpdate)
    .where(eq(webhook.id, webhookRow.id));
}

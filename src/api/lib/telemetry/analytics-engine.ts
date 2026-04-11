import type { TelemetryEvent, TelemetrySink } from "./types";

/**
 * Telemetry sink that writes data points to Cloudflare Analytics Engine.
 *
 * Analytics Engine stores each data point as a fixed set of blobs (strings)
 * and doubles (numbers). The `track()` method maps every `TelemetryEvent`
 * variant to the corresponding blob/double layout so downstream SQL queries
 * can filter and aggregate efficiently.
 *
 * `writeDataPoint` is fire-and-forget — it never returns a promise and
 * Cloudflare batches the writes internally — so `flush()` is a no-op.
 *
 * The entire `track()` body is wrapped in try/catch because telemetry must
 * **never** crash the request path.  A failed data point is logged and
 * silently dropped.
 */
export class AnalyticsEngineSink implements TelemetrySink {
  private readonly dataset: AnalyticsEngineDataset;

  constructor(dataset: AnalyticsEngineDataset) {
    this.dataset = dataset;
  }

  track(event: TelemetryEvent): void {
    try {
      switch (event.type) {
        case "http_request": {
          this.dataset.writeDataPoint({
            indexes: [event.type],
            blobs: [
              event.method,
              event.path,
              event.requestId,
              event.userId ?? "",
              event.workspaceId ?? "",
            ],
            doubles: [event.status, event.durationMs],
          });
          break;
        }

        case "webhook_delivery": {
          this.dataset.writeDataPoint({
            indexes: [event.type],
            blobs: [
              event.webhookId,
              event.deliveryId,
              event.event,
              event.workspaceId,
            ],
            doubles: [
              event.success ? 1 : 0,
              event.statusCode ?? 0,
              event.durationMs,
              event.attempt,
            ],
          });
          break;
        }

        case "webhook_retry": {
          this.dataset.writeDataPoint({
            indexes: [event.type],
            blobs: [
              event.webhookId,
              event.deliveryId,
              event.event,
              event.workspaceId,
            ],
            doubles: [
              event.success ? 1 : 0,
              event.statusCode ?? 0,
              event.durationMs,
              event.attempt,
            ],
          });
          break;
        }

        case "cron_run": {
          this.dataset.writeDataPoint({
            indexes: [event.type],
            blobs: [],
            doubles: [event.durationMs, event.tasksRun, event.errors],
          });
          break;
        }

        case "cron_task": {
          this.dataset.writeDataPoint({
            indexes: [event.type],
            blobs: [event.taskName],
            doubles: [event.durationMs, event.count, event.success ? 1 : 0],
          });
          break;
        }
      }
    } catch (error) {
      console.error("[telemetry] Failed to write data point:", error);
    }
  }

  flush(): Promise<void> {
    // writeDataPoint is fire-and-forget — nothing to flush.
    return Promise.resolve();
  }
}

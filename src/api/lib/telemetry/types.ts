// ---------------------------------------------------------------------------
// Telemetry types — the contract between instrumentation and sink adapters.
//
// Every telemetry event is a variant of the `TelemetryEvent` discriminated
// union.  Adapters switch on `type` to map fields into their output format
// (Analytics Engine blobs/doubles, structured JSON, etc.).
//
// Adding a new event: add a variant here, then update each adapter's
// `track()` switch.
// ---------------------------------------------------------------------------

/** Discriminated union of all telemetry events. */
export type TelemetryEvent =
  | HttpRequestEvent
  | WebhookDeliveryEvent
  | WebhookRetryEvent
  | CronRunEvent
  | CronTaskEvent;

// ---------------------------------------------------------------------------
// Event variants
// ---------------------------------------------------------------------------

export interface HttpRequestEvent {
  type: "http_request";
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
  userId?: string | null;
  workspaceId?: string | null;
}

export interface WebhookDeliveryEvent {
  type: "webhook_delivery";
  webhookId: string;
  deliveryId: string;
  event: string;
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  attempt: number;
  workspaceId: string;
}

export interface WebhookRetryEvent {
  type: "webhook_retry";
  webhookId: string;
  deliveryId: string;
  event: string;
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  attempt: number;
  workspaceId: string;
}

export interface CronRunEvent {
  type: "cron_run";
  durationMs: number;
  tasksRun: number;
  errors: number;
}

export interface CronTaskEvent {
  type: "cron_task";
  taskName: string;
  durationMs: number;
  count: number;
  success: boolean;
}

// ---------------------------------------------------------------------------
// Sink interface
// ---------------------------------------------------------------------------

/**
 * The core telemetry sink contract.
 *
 * Adapters implement this to route telemetry events to their destination
 * (Analytics Engine, console, external services, /dev/null).
 *
 * `track()` is intentionally synchronous — Analytics Engine's
 * `writeDataPoint` is synchronous and console logging is synchronous.
 * This guarantees the telemetry layer can never block the request path.
 *
 * `flush()` exists for future buffered adapters (e.g. Axiom batch HTTP)
 * that need to drain before the Worker invocation ends.
 */
export interface TelemetrySink {
  /** Record a telemetry event. Must never throw or block. */
  track(event: TelemetryEvent): void;
  /** Flush any buffered data. No-op for fire-and-forget adapters. */
  flush(): Promise<void>;
}

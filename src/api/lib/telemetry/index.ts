import { AnalyticsEngineSink } from "./analytics-engine";
import { ConsoleSink } from "./console";
import { NoopSink } from "./noop";
import type { TelemetrySink } from "./types";

export function createTelemetrySink(env: {
  ANALYTICS?: AnalyticsEngineDataset;
  TELEMETRY_SINK?: string;
}): TelemetrySink {
  // Explicit override via env var takes precedence
  if (env.TELEMETRY_SINK === "noop") {
    return new NoopSink();
  }
  if (env.TELEMETRY_SINK === "console") {
    return new ConsoleSink();
  }

  // Auto-detect: if Analytics Engine binding exists, use it
  if (env.ANALYTICS) {
    return new AnalyticsEngineSink(env.ANALYTICS);
  }

  // Fallback: console output — visible in wrangler dev, harmless in production
  return new ConsoleSink();
}

export { AnalyticsEngineSink } from "./analytics-engine";
export { ConsoleSink } from "./console";
export { NoopSink } from "./noop";
export type {
  CronRunEvent,
  CronTaskEvent,
  HttpRequestEvent,
  TelemetryEvent,
  TelemetrySink,
  WebhookDeliveryEvent,
  WebhookRetryEvent,
} from "./types";

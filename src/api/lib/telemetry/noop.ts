import type { TelemetryEvent,TelemetrySink } from "./types";

/**
 * A no-op telemetry sink that silently discards all events.
 *
 * Used when telemetry is disabled (no Analytics Engine binding, local dev
 * without telemetry, tests that don't care about instrumentation).  The
 * implementation is intentionally trivial — `track()` is an empty body and
 * `flush()` resolves immediately — so it can never throw, block, or
 * allocate meaningful memory.
 */
export class NoopSink implements TelemetrySink {
  track(event: TelemetryEvent): void {
    // Intentional no-op — telemetry is disabled.
    void event;
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }
}

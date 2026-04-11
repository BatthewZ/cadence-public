import type { TelemetryEvent,TelemetrySink } from "./types";

/**
 * A telemetry sink that writes structured JSON to the console.
 *
 * Each call to `track()` outputs a single `console.log` line containing the
 * full event payload prefixed with a `_tag: "telemetry"` discriminator.  This
 * distinguishes telemetry output from the regular request logger (which emits
 * plain structured JSON without a `_tag` field), making it easy to filter in
 * log aggregators or `wrangler tail`.
 *
 * The entire `track()` body is wrapped in try/catch because telemetry must
 * never crash the application — a serialisation error or out-of-memory
 * condition should be logged as a warning, not propagated to the caller.
 *
 * `flush()` is a no-op because `console.log` is synchronous and unbuffered.
 */
export class ConsoleSink implements TelemetrySink {
  track(event: TelemetryEvent): void {
    try {
      console.log(JSON.stringify({ _tag: "telemetry", ...event }));
    } catch (err) {
      console.error(
        "[telemetry] Failed to write event:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }
}

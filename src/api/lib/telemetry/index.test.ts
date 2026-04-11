import { describe, expect, it, vi } from "vitest";

import { AnalyticsEngineSink } from "./analytics-engine";
import { ConsoleSink } from "./console";
import { createTelemetrySink } from "./index";
import { NoopSink } from "./noop";

describe("createTelemetrySink", () => {
  // ---------------------------------------------------------------------------
  // Explicit TELEMETRY_SINK overrides
  // ---------------------------------------------------------------------------

  it("returns NoopSink when TELEMETRY_SINK is 'noop'", () => {
    const sink = createTelemetrySink({ TELEMETRY_SINK: "noop" });
    expect(sink).toBeInstanceOf(NoopSink);
  });

  it("returns ConsoleSink when TELEMETRY_SINK is 'console'", () => {
    const sink = createTelemetrySink({ TELEMETRY_SINK: "console" });
    expect(sink).toBeInstanceOf(ConsoleSink);
  });

  // ---------------------------------------------------------------------------
  // Auto-detection via ANALYTICS binding
  // ---------------------------------------------------------------------------

  it("returns AnalyticsEngineSink when ANALYTICS binding is provided", () => {
    const mockDataset = {
      writeDataPoint: vi.fn(),
    } as unknown as AnalyticsEngineDataset;

    const sink = createTelemetrySink({ ANALYTICS: mockDataset });
    expect(sink).toBeInstanceOf(AnalyticsEngineSink);
  });

  // ---------------------------------------------------------------------------
  // Fallback
  // ---------------------------------------------------------------------------

  it("returns ConsoleSink as fallback when no bindings are provided", () => {
    const sink = createTelemetrySink({});
    expect(sink).toBeInstanceOf(ConsoleSink);
  });

  // ---------------------------------------------------------------------------
  // Precedence: TELEMETRY_SINK override wins over ANALYTICS binding
  // ---------------------------------------------------------------------------

  it("TELEMETRY_SINK override takes precedence over ANALYTICS binding", () => {
    const mockDataset = {
      writeDataPoint: vi.fn(),
    } as unknown as AnalyticsEngineDataset;

    const sink = createTelemetrySink({
      ANALYTICS: mockDataset,
      TELEMETRY_SINK: "console",
    });
    expect(sink).toBeInstanceOf(ConsoleSink);
  });

  it("TELEMETRY_SINK 'noop' takes precedence over ANALYTICS binding", () => {
    const mockDataset = {
      writeDataPoint: vi.fn(),
    } as unknown as AnalyticsEngineDataset;

    const sink = createTelemetrySink({
      ANALYTICS: mockDataset,
      TELEMETRY_SINK: "noop",
    });
    expect(sink).toBeInstanceOf(NoopSink);
  });
});

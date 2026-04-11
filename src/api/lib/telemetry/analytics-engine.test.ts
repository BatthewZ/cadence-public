import { describe, expect, it, vi } from "vitest";

import { AnalyticsEngineSink } from "./analytics-engine";
import type {
  CronRunEvent,
  CronTaskEvent,
  HttpRequestEvent,
  WebhookDeliveryEvent,
  WebhookRetryEvent,
} from "./types";

/**
 * These tests verify the Analytics Engine sink correctly maps every
 * TelemetryEvent variant to the expected blob/double layout.
 *
 * Because Miniflare does not support Analytics Engine, we mock the
 * `AnalyticsEngineDataset` binding and assert against the arguments
 * passed to `writeDataPoint`.
 *
 * We keep a separate reference to the `vi.fn()` mock so ESLint's
 * `unbound-method` rule does not fire when we pass it to `expect()`.
 */

function createMockDataset() {
  const writeDataPoint = vi.fn();
  const dataset = { writeDataPoint } as unknown as AnalyticsEngineDataset;
  return { dataset, writeDataPoint };
}

describe("AnalyticsEngineSink", () => {
  // -----------------------------------------------------------------------
  // http_request
  // -----------------------------------------------------------------------
  describe("http_request", () => {
    it("maps all fields to the correct blobs and doubles", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      const sink = new AnalyticsEngineSink(dataset);

      const event: HttpRequestEvent = {
        type: "http_request",
        method: "GET",
        path: "/api/tasks",
        status: 200,
        durationMs: 42,
        requestId: "req-123",
        userId: "user-1",
        workspaceId: "ws-1",
      };

      sink.track(event);

      expect(writeDataPoint).toHaveBeenCalledOnce();
      expect(writeDataPoint).toHaveBeenCalledWith({
        indexes: ["http_request"],
        blobs: ["GET", "/api/tasks", "req-123", "user-1", "ws-1"],
        doubles: [200, 42],
      });
    });

    it("defaults userId and workspaceId to empty string when null", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      const sink = new AnalyticsEngineSink(dataset);

      const event: HttpRequestEvent = {
        type: "http_request",
        method: "POST",
        path: "/api/auth/login",
        status: 401,
        durationMs: 5,
        requestId: "req-456",
        userId: null,
        workspaceId: null,
      };

      sink.track(event);

      expect(writeDataPoint).toHaveBeenCalledWith(
        expect.objectContaining({
          blobs: ["POST", "/api/auth/login", "req-456", "", ""],
        }),
      );
    });

    it("defaults userId and workspaceId to empty string when undefined", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      const sink = new AnalyticsEngineSink(dataset);

      const event: HttpRequestEvent = {
        type: "http_request",
        method: "GET",
        path: "/api/health",
        status: 200,
        durationMs: 1,
        requestId: "req-789",
      };

      sink.track(event);

      expect(writeDataPoint).toHaveBeenCalledWith(
        expect.objectContaining({
          blobs: ["GET", "/api/health", "req-789", "", ""],
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // webhook_delivery
  // -----------------------------------------------------------------------
  describe("webhook_delivery", () => {
    it("maps all fields to the correct blobs and doubles", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      const sink = new AnalyticsEngineSink(dataset);

      const event: WebhookDeliveryEvent = {
        type: "webhook_delivery",
        webhookId: "wh-1",
        deliveryId: "del-1",
        event: "task.created",
        success: true,
        statusCode: 200,
        durationMs: 150,
        attempt: 1,
        workspaceId: "ws-1",
      };

      sink.track(event);

      expect(writeDataPoint).toHaveBeenCalledOnce();
      expect(writeDataPoint).toHaveBeenCalledWith({
        indexes: ["webhook_delivery"],
        blobs: ["wh-1", "del-1", "task.created", "ws-1"],
        doubles: [1, 200, 150, 1],
      });
    });

    it("maps null statusCode to 0 and false success to 0", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      const sink = new AnalyticsEngineSink(dataset);

      const event: WebhookDeliveryEvent = {
        type: "webhook_delivery",
        webhookId: "wh-2",
        deliveryId: "del-2",
        event: "task.updated",
        success: false,
        statusCode: null,
        durationMs: 3000,
        attempt: 3,
        workspaceId: "ws-2",
      };

      sink.track(event);

      expect(writeDataPoint).toHaveBeenCalledWith({
        indexes: ["webhook_delivery"],
        blobs: ["wh-2", "del-2", "task.updated", "ws-2"],
        doubles: [0, 0, 3000, 3],
      });
    });
  });

  // -----------------------------------------------------------------------
  // webhook_retry
  // -----------------------------------------------------------------------
  describe("webhook_retry", () => {
    it("maps all fields to the correct blobs and doubles", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      const sink = new AnalyticsEngineSink(dataset);

      const event: WebhookRetryEvent = {
        type: "webhook_retry",
        webhookId: "wh-3",
        deliveryId: "del-3",
        event: "project.deleted",
        success: true,
        statusCode: 201,
        durationMs: 80,
        attempt: 2,
        workspaceId: "ws-3",
      };

      sink.track(event);

      expect(writeDataPoint).toHaveBeenCalledOnce();
      expect(writeDataPoint).toHaveBeenCalledWith({
        indexes: ["webhook_retry"],
        blobs: ["wh-3", "del-3", "project.deleted", "ws-3"],
        doubles: [1, 201, 80, 2],
      });
    });

    it("maps null statusCode to 0", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      const sink = new AnalyticsEngineSink(dataset);

      const event: WebhookRetryEvent = {
        type: "webhook_retry",
        webhookId: "wh-4",
        deliveryId: "del-4",
        event: "task.deleted",
        success: false,
        statusCode: null,
        durationMs: 5000,
        attempt: 5,
        workspaceId: "ws-4",
      };

      sink.track(event);

      expect(writeDataPoint).toHaveBeenCalledWith({
        indexes: ["webhook_retry"],
        blobs: ["wh-4", "del-4", "task.deleted", "ws-4"],
        doubles: [0, 0, 5000, 5],
      });
    });
  });

  // -----------------------------------------------------------------------
  // cron_run
  // -----------------------------------------------------------------------
  describe("cron_run", () => {
    it("maps all fields to empty blobs and correct doubles", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      const sink = new AnalyticsEngineSink(dataset);

      const event: CronRunEvent = {
        type: "cron_run",
        durationMs: 1200,
        tasksRun: 5,
        errors: 1,
      };

      sink.track(event);

      expect(writeDataPoint).toHaveBeenCalledOnce();
      expect(writeDataPoint).toHaveBeenCalledWith({
        indexes: ["cron_run"],
        blobs: [],
        doubles: [1200, 5, 1],
      });
    });
  });

  // -----------------------------------------------------------------------
  // cron_task
  // -----------------------------------------------------------------------
  describe("cron_task", () => {
    it("maps all fields to the correct blobs and doubles", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      const sink = new AnalyticsEngineSink(dataset);

      const event: CronTaskEvent = {
        type: "cron_task",
        taskName: "notification-cleanup",
        durationMs: 300,
        count: 42,
        success: true,
      };

      sink.track(event);

      expect(writeDataPoint).toHaveBeenCalledOnce();
      expect(writeDataPoint).toHaveBeenCalledWith({
        indexes: ["cron_task"],
        blobs: ["notification-cleanup"],
        doubles: [300, 42, 1],
      });
    });

    it("maps false success to 0", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      const sink = new AnalyticsEngineSink(dataset);

      const event: CronTaskEvent = {
        type: "cron_task",
        taskName: "broken-task",
        durationMs: 50,
        count: 0,
        success: false,
      };

      sink.track(event);

      expect(writeDataPoint).toHaveBeenCalledWith({
        indexes: ["cron_task"],
        blobs: ["broken-task"],
        doubles: [50, 0, 0],
      });
    });
  });

  // -----------------------------------------------------------------------
  // Error isolation
  // -----------------------------------------------------------------------
  describe("error isolation", () => {
    it("catches errors from writeDataPoint and does not propagate", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      writeDataPoint.mockImplementation(() => {
        throw new Error("Analytics Engine unavailable");
      });

      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const sink = new AnalyticsEngineSink(dataset);

      expect(() => {
        sink.track({
          type: "http_request",
          method: "GET",
          path: "/",
          status: 200,
          durationMs: 1,
          requestId: "req-err",
        });
      }).not.toThrow();

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledWith(
        "[telemetry] Failed to write data point:",
        expect.any(Error),
      );

      errorSpy.mockRestore();
    });

    it("catches errors for every event type without propagating", () => {
      const { dataset, writeDataPoint } = createMockDataset();
      writeDataPoint.mockImplementation(() => {
        throw new Error("boom");
      });

      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const sink = new AnalyticsEngineSink(dataset);

      expect(() => {
        sink.track({
          type: "cron_run",
          durationMs: 100,
          tasksRun: 1,
          errors: 0,
        });
      }).not.toThrow();

      expect(() => {
        sink.track({
          type: "webhook_delivery",
          webhookId: "wh",
          deliveryId: "del",
          event: "e",
          success: true,
          statusCode: 200,
          durationMs: 1,
          attempt: 1,
          workspaceId: "ws",
        });
      }).not.toThrow();

      expect(errorSpy).toHaveBeenCalledTimes(2);

      errorSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // flush
  // -----------------------------------------------------------------------
  describe("flush", () => {
    it("resolves immediately (no-op)", async () => {
      const { dataset } = createMockDataset();
      const sink = new AnalyticsEngineSink(dataset);

      await expect(sink.flush()).resolves.toBeUndefined();
    });
  });
});

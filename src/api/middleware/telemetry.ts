import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../env";
import { createTelemetrySink } from "../lib/telemetry";

export const telemetryMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const sink = createTelemetrySink(c.env);
  c.set("telemetry", sink);

  const start = Date.now();
  await next();
  const durationMs = Date.now() - start;

  sink.track({
    type: "http_request",
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs,
    requestId: c.get("requestId") ?? "unknown",
    userId: c.get("user")?.id ?? null,
    workspaceId: c.get("workspaceMembership")?.workspaceId ?? null,
  });
});

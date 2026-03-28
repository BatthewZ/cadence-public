import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../env";

export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  console.log(
    JSON.stringify({
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration,
      requestId: c.get("requestId") ?? null,
      ip: c.req.header("cf-connecting-ip") ?? null,
      userAgent: c.req.header("user-agent")?.slice(0, 128) ?? null,
    })
  );
});

import type { Context } from "hono";

import type { AppEnv } from "../env";

/**
 * Defer non-critical work to run after the response is sent.
 *
 * Uses the Cloudflare Workers `waitUntil()` API so the response is returned
 * immediately while activity logging, notifications, and other side-effects
 * continue executing in the background.
 *
 * When no ExecutionContext is available (e.g. in tests with Miniflare), the
 * work is executed inline so that tests can still assert on side-effects like
 * activity logs and notifications.
 */
export function deferWork(
  c: Context<AppEnv>,
  work: () => Promise<unknown>,
): void {
  let ctx: ExecutionContext;
  try {
    ctx = c.executionCtx;
  } catch {
    // No ExecutionContext (test env) — run inline so tests can verify side-effects
    void work().catch((err) => console.error("[defer] deferred work failed:", err));
    return;
  }
  ctx.waitUntil(work().catch((err) => console.error("[defer] deferred work failed:", err)));
}

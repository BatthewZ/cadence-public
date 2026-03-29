import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { AppEnv } from "../env";

/** Returns a JSON error response that always includes requestId. */
export function errorResponse(
  c: Context<AppEnv>,
  message: string,
  status: ContentfulStatusCode,
  extra?: Record<string, unknown>,
) {
  const requestId = c.get("requestId") ?? "unknown";
  return c.json({ error: message, requestId, ...extra }, status);
}

/** Re-throws an error with a contextual prefix on the message. Preserves stack. */
export function throwWithContext(error: unknown, context: string): never {
  if (error instanceof Error) {
    error.message = `[${context}] ${error.message}`;
  }
  throw error;
}

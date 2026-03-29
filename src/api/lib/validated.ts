import type { Context } from "hono";
import type { z, ZodSchema } from "zod";

/**
 * Internal helper that accesses Hono's validated data store.
 *
 * Hono stores validated data on the request object but the `.valid()` method
 * is not available on the base `HonoRequest` type — it requires middleware-
 * augmented generics that don't propagate when handlers are standalone
 * exported functions typed as `Context<AppEnv>`.
 *
 * We cast through `unknown` (rather than `any`) to satisfy the linter, then
 * call the method by name. This is safe because the zValidator middleware has
 * already parsed and stored the data before the handler runs.
 */
type ReqWithValid = { valid: (target: string) => unknown };

function extractValid(c: Context, target: "json" | "query"): unknown {
  return (c.req as unknown as ReqWithValid).valid(target);
}

/**
 * Extracts validated JSON body from Hono context with proper type inference.
 *
 * Why: Hono cannot propagate validated input types through middleware chains
 * when handlers are standalone exported functions typed as Context<AppEnv>.
 * The zValidator middleware has already parsed and validated the body by the
 * time the handler runs. The schema parameter is used only for type inference
 * (z.output<T>), not re-parsed at runtime.
 */
export function validJson<T extends ZodSchema>(c: Context, schema: T): z.output<T> {
  void schema;
  return extractValid(c, "json") as z.output<T>;
}

export function validQuery<T extends ZodSchema>(c: Context, schema: T): z.output<T> {
  void schema;
  return extractValid(c, "query") as z.output<T>;
}

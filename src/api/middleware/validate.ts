import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { ZodType } from "zod";

/**
 * Validation hook for zValidator.
 *
 * Note: we inline c.json() instead of using errorResponse() because
 * zValidator provides a generic Context<Env> that is incompatible with
 * our Context<AppEnv>-typed errorResponse helper.
 */
export function validationHook(
  result: {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  },
  c: Context,
) {
  if (!result.success) {
    return c.json(
      {
        error: "Validation failed",
        details: result.error!.issues.map((i) => ({
          path: i.path.map(String).join("."),
          message: i.message,
        })),
      },
      400,
    );
  }
}

/**
 * Validates request body against a Zod schema.
 * Returns 400 with { error: "Validation failed", details: [...] } on failure.
 */
export function validateBody<T extends ZodType>(schema: T) {
  return zValidator("json", schema, validationHook);
}

/**
 * Validates query parameters against a Zod schema.
 */
export function validateQuery<T extends ZodType>(schema: T) {
  return zValidator("query", schema, validationHook);
}

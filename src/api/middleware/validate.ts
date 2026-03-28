import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { ZodSchema } from "zod";

function validationHook(
  result: {
    success: boolean;
    error?: { issues: { path: (string | number)[]; message: string }[] };
  },
  c: Context
) {
  if (!result.success) {
    return c.json(
      {
        error: "Validation failed",
        details: result.error!.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      400
    );
  }
}

/**
 * Validates request body against a Zod schema.
 * Returns 400 with { error: "Validation failed", details: [...] } on failure.
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return zValidator("json", schema, validationHook);
}

/**
 * Validates query parameters against a Zod schema.
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return zValidator("query", schema, validationHook);
}

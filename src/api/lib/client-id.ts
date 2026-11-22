import { eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Context } from "hono";

import { WRITE_ERROR_CODES } from "../../shared/constants/offline-sync";
import type { AppEnv } from "../env";
import { errorResponse } from "./error-response";

/**
 * The 409 `id_conflict` response when a create's client-supplied `id` already
 * exists anywhere in `table`, else null.
 *
 * Call before `retryOnPositionConflict`: it reads every UNIQUE violation,
 * the primary key's included, as a position race and retries until it throws.
 */
export async function clientIdConflict(
  c: Context<AppEnv>,
  table: SQLiteTable & { id: SQLiteColumn },
  id: string | undefined,
): Promise<Response | null> {
  if (id === undefined) return null;
  const [existing] = await c
    .get("db")
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  if (!existing) return null;
  return errorResponse(c, "A record with this id already exists", 409, {
    code: WRITE_ERROR_CODES.idConflict,
  });
}

import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

import { legalAcceptance } from "../../../db/schema/legal-acceptance";
import { CURRENT_TOS_VERSION } from "../../../shared/constants/legal";
import { acceptTosSchema } from "../../../shared/schemas/legal";
import type { AppEnv } from "../../env";
import { errorResponse, throwWithContext } from "../../lib/error-response";
import { validJson } from "../../lib/validated";

/**
 * Returns whether the authenticated user has accepted the current Terms of Service version.
 * Used by the frontend to gate access behind ToS acceptance.
 */
export async function getTosStatus(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;

  const [record] = await db
    .select({ id: legalAcceptance.id })
    .from(legalAcceptance)
    .where(
      and(
        eq(legalAcceptance.userId, user.id),
        eq(legalAcceptance.tosVersion, CURRENT_TOS_VERSION),
      ),
    )
    .limit(1);

  return c.json({
    accepted: !!record,
    currentVersion: CURRENT_TOS_VERSION,
  });
}

/**
 * Records the authenticated user's acceptance of a specific Terms of Service version.
 * Validates that the submitted version matches the current version and is idempotent
 * (re-accepting an already-accepted version is a no-op success).
 */
export async function acceptTos(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user")!;
  const body = validJson(c, acceptTosSchema);

  if (body.tosVersion !== CURRENT_TOS_VERSION) {
    return errorResponse(c, "Version mismatch: please accept the current Terms of Service", 400);
  }

  const [existing] = await db
    .select({ id: legalAcceptance.id })
    .from(legalAcceptance)
    .where(
      and(
        eq(legalAcceptance.userId, user.id),
        eq(legalAcceptance.tosVersion, CURRENT_TOS_VERSION),
      ),
    )
    .limit(1);

  if (!existing) {
    try {
      await db.insert(legalAcceptance).values({
        id: crypto.randomUUID(),
        userId: user.id,
        tosVersion: CURRENT_TOS_VERSION,
        acceptedAt: new Date(),
      });
    } catch (error) {
      throwWithContext(error, "acceptTos");
    }
  }

  return c.json({ accepted: true });
}

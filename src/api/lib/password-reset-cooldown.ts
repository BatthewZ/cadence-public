/**
 * Per-email cooldown for password reset requests.
 *
 * Better Auth creates a new verification token *before* calling the
 * sendResetPassword callback, so spamming the endpoint generates tokens
 * and triggers emails even though Better Auth's in-memory rate limiter
 * is per-isolate only. This module provides a D1-backed (distributed)
 * cooldown that prevents sending more than one reset email per user
 * within a configurable window.
 */

import { and, eq, gt, like, lt } from "drizzle-orm";

import type { Database } from "../../db";
import * as schema from "../../db/schema";

const COOLDOWN_SECONDS = 300; // 5 minutes
const BUFFER_SECONDS = 5; // Exclude the token just created by the current request

/**
 * Returns true if a password reset email was recently sent to this user,
 * meaning we should suppress the current send.
 *
 * Queries D1 directly, making this check distributed across all edge
 * locations — unlike in-memory rate limiting which is per-isolate.
 */
export async function isResetCooldownActive(
  db: Database,
  userId: string,
  cooldownSeconds = COOLDOWN_SECONDS,
  bufferSeconds = BUFFER_SECONDS,
): Promise<boolean> {
  const cooldownStart = new Date(Date.now() - cooldownSeconds * 1000);
  const recentBuffer = new Date(Date.now() - bufferSeconds * 1000);

  const recentTokens = await db
    .select({ id: schema.verification.id })
    .from(schema.verification)
    .where(
      and(
        eq(schema.verification.value, userId),
        like(schema.verification.identifier, "reset-password:%"),
        gt(schema.verification.createdAt, cooldownStart),
        lt(schema.verification.createdAt, recentBuffer),
      ),
    )
    .limit(1);

  return recentTokens.length > 0;
}

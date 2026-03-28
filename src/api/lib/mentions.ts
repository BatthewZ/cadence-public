import { eq } from "drizzle-orm";

import type { Database } from "../../db";
import { user as userTable } from "../../db/schema/auth";
import { projectMember } from "../../db/schema/project";

/**
 * Extract @mentions from text and resolve them to user IDs.
 *
 * Resolution strategy (evaluated in order):
 * 1. `@"Full Name"` — quoted, exact match
 * 2. `@Word` — matches against member names: first tries exact full-name,
 *    then checks if any word in the member's name matches, then tries
 *    multi-word lookahead (e.g. `@Ben M` matches "Ben M" without quotes)
 *
 * Only resolves against direct project members so non-members
 * are never notified about projects they cannot access.
 */
export async function parseMentions(
  db: Database,
  text: string,
  projectId: string,
): Promise<string[]> {
  const members = await db
    .select({ userId: projectMember.userId, name: userTable.name })
    .from(projectMember)
    .innerJoin(userTable, eq(projectMember.userId, userTable.id))
    .where(eq(projectMember.projectId, projectId));

  if (members.length === 0) return [];

  const resolvedIds: string[] = [];

  // Pass 1: quoted mentions — exact full-name match
  const quotedPattern = /@"([^"]+)"/g;
  let match;
  while ((match = quotedPattern.exec(text)) !== null) {
    const lower = match[1].toLowerCase();
    const found = members.find((m) => m.name.toLowerCase() === lower);
    if (found) resolvedIds.push(found.userId);
  }

  // Pass 2: unquoted mentions — try multi-word match against known member
  // names first, then fall back to single-word matching
  const unquotedPattern = /@(\w+)/g;
  while ((match = unquotedPattern.exec(text)) !== null) {
    // Skip if this @ is inside a quoted mention
    const beforeAt = text.lastIndexOf("@\"", match.index);
    if (beforeAt !== -1 && beforeAt === match.index - 1) continue;

    const startPos = match.index + 1; // position after @
    const remaining = text.substring(startPos);

    // Try matching the longest member name starting at this position
    const found = members
      .filter((m) => remaining.toLowerCase().startsWith(m.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0];

    if (found) {
      resolvedIds.push(found.userId);
    } else {
      // Fall back to single-word match against name parts
      const word = match[1].toLowerCase();
      const partial = members.find((m) =>
        m.name.toLowerCase().split(/\s+/).some((w) => w === word),
      );
      if (partial) resolvedIds.push(partial.userId);
    }
  }

  return [...new Set(resolvedIds)];
}

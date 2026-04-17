/**
 * Stable sort by fractional-index `position` with `id` as tiebreaker.
 *
 * The tiebreaker matters whenever two items can share a position string —
 * the server dedup migration and UNIQUE index remove steady-state ties,
 * but transient duplicates can still appear during optimistic reorders
 * (two sources update local state before the server response reconciles).
 * A stable secondary sort keeps the UI from appearing to shuffle tied
 * siblings when an unrelated item's position changes.
 *
 * Server-side list queries apply the same `(position, id)` ordering, so
 * hydrated server data and optimistic client-side state agree.
 */
export function sortByPosition<T extends { position: string; id: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.position < b.position) return -1;
    if (a.position > b.position) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

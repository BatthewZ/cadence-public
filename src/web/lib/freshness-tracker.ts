/**
 * Tracks when the local user last mutated each entity type to suppress
 * redundant freshness-triggered invalidations for the user's own changes.
 *
 * When a user mutates data, their React Query cache is already updated
 * optimistically. Without suppression, the next freshness poll would detect
 * the server-side timestamp change and trigger an unnecessary refetch of data
 * the client already has.
 *
 * This is an optimisation — the system works correctly without it, just with
 * one wasted refetch per mutation. We may remove it later if it proves
 * unnecessary.
 */
class FreshnessTracker {
  private lastMutationAt = new Map<string, number>();
  private suppressionWindowMs = 3000;

  /**
   * Record that the current user is mutating an entity type.
   *
   * Call from `onMutate`, not a settle handler: the poll cycle is shorter than a
   * slow request, so a window opened only once the write finishes leaves the
   * whole in-flight period free to repaint the pre-write value over an
   * optimistic one.
   */
  recordMutation(entityType: string): void {
    this.lastMutationAt.set(entityType, Date.now());
  }

  /**
   * Returns true if a freshness-triggered invalidation should proceed for
   * this entity type. Returns false if the user recently mutated it and the
   * suppression window has not elapsed.
   */
  shouldInvalidate(entityType: string): boolean {
    const lastMutation = this.lastMutationAt.get(entityType);
    if (!lastMutation) return true;
    return Date.now() - lastMutation > this.suppressionWindowMs;
  }
}

export const freshnessTracker = new FreshnessTracker();

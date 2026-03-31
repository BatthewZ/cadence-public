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
   * Record that the current user just mutated an entity type.
   * Call this from mutation hooks after the optimistic update is applied.
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

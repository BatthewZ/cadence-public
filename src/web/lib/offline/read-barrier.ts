// GETs wait while the write queue is actively draining, so a refetch can't paint server state
// that predates the user's own queued writes.
// Keep this a leaf module: the API client imports it and the queue registers itself here,
// so importing either from this file creates a cycle.

type Barrier = () => Promise<void>;

let barrier: Barrier | null = null;

export function setReadBarrier(next: Barrier | null): void {
  barrier = next;
}

export function awaitReadBarrier(): Promise<void> {
  return barrier ? barrier() : Promise.resolve();
}

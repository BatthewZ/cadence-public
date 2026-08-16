/** Structural subset of a TanStack `Query` — the fetch counter the delay is keyed on. */
interface PolledQuery {
  state: { dataUpdateCount: number; errorUpdateCount: number };
}

const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

/** Per-tab phase, so two clients on the same tick pick different delays. */
const sessionPhase = Math.random();

/**
 * Build a `refetchInterval` callback that jitters `baseMs` by `±ratio`,
 * desynchronizing clients so they don't all fire the same heavy invalidation
 * refetches inside the same poll window.
 *
 * The delay is a pure function of the query's fetch count, NOT of `Math.random()`
 * at call time. TanStack re-reads `refetchInterval` on every `setOptions` — which
 * React runs on every render — and restarts the timer whenever the returned
 * number differs from the running one. A delay that re-rolls per call therefore
 * resets the timer on every render, and a component that re-renders faster than
 * its own poll interval never polls again. Keying on the fetch count re-rolls
 * once per completed tick, which is the intent, and leaves renders inert.
 *
 * @param baseMs Centre of the interval, in milliseconds. Must be positive.
 * @param ratio Fractional spread each side of `baseMs`. `0.2` → ±20%.
 * @throws RangeError on non-finite/out-of-range input — a bad constant should be
 *   loud at first render, not silently clamped into a hot-spinning timer.
 */
export function jitteredInterval(
  baseMs: number,
  ratio = 0.2,
): (query: PolledQuery) => number {
  if (!Number.isFinite(baseMs) || baseMs <= 0) {
    throw new RangeError(
      `jitteredInterval: baseMs must be a positive finite number, got ${baseMs}`,
    );
  }
  if (!Number.isFinite(ratio) || ratio < 0 || ratio >= 1) {
    throw new RangeError(
      `jitteredInterval: ratio must be within [0, 1), got ${ratio}`,
    );
  }

  const spread = baseMs * ratio;
  return (query) => {
    const tick = query.state.dataUpdateCount + query.state.errorUpdateCount;
    // Golden-ratio stepping: successive ticks spread across the band instead of
    // walking it in order. Phase spans [0, 1) → result spans base ± spread.
    const phase = (sessionPhase + tick * GOLDEN_RATIO_CONJUGATE) % 1;
    return Math.round(baseMs + (phase * 2 - 1) * spread);
  };
}

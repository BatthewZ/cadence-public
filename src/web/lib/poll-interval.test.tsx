/**
 * Tests for the poll-interval jitter helper.
 *
 * Why these matter: the whole point of the helper is that N clients do NOT land
 * on the same instant. A regression that quietly returns a constant (a dropped
 * jitter term, a collapsed spread) would still typecheck, still poll, and still
 * pass any test that only asserted "returns a number" — so the suite pins the
 * two properties that actually carry the value: the result VARIES across ticks,
 * and it stays inside the band callers reason about when they pick a base.
 *
 * It also pins the property that is invisible in isolation and fatal in situ:
 * the delay must be STABLE for a given fetch count. TanStack restarts the poll
 * timer whenever the number changes, and React calls `setOptions` on every
 * render, so a per-call re-roll silently stops the poller dead. The
 * `useQuery` test at the bottom is the only thing that catches that.
 *
 * The input validation tests exist because the failure mode of a bad constant is
 * a hot-spinning timer hammering the API, which is exactly the kind of thing that
 * should be loud at first render rather than clamped into silence.
 */
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jitteredInterval } from "./poll-interval";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Stand-in for the TanStack `Query` the callback receives. */
function queryAtTick(tick: number) {
  return { state: { dataUpdateCount: tick, errorUpdateCount: 0 } };
}

describe("jitteredInterval", () => {
  it("returns a function so TanStack re-rolls the delay on every tick", () => {
    expect(typeof jitteredInterval(1000)).toBe("function");
  });

  it("stays within ±ratio of the base across many ticks", () => {
    const next = jitteredInterval(1500, 0.2);
    for (let tick = 0; tick < 2000; tick++) {
      const value = next(queryAtTick(tick));
      expect(value).toBeGreaterThanOrEqual(1200);
      expect(value).toBeLessThanOrEqual(1800);
    }
  });

  it("actually varies across ticks — a constant would defeat the purpose", () => {
    const next = jitteredInterval(1500, 0.2);
    const seen = new Set<number>();
    for (let tick = 0; tick < 100; tick++) seen.add(next(queryAtTick(tick)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("spans the full band, not a token wobble around the base", () => {
    // Pins the spread's magnitude: a helper that jittered by ±1ms would pass the
    // bounds and variance checks above while spreading nothing.
    const next = jitteredInterval(1000, 0.2);
    let min = Infinity;
    let max = -Infinity;
    for (let tick = 0; tick < 5000; tick++) {
      const value = next(queryAtTick(tick));
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(min).toBeLessThan(830);
    expect(max).toBeGreaterThan(1170);
  });

  it("counts a failed fetch as a tick, so a retrying poller still spreads", () => {
    const next = jitteredInterval(1000, 0.2);
    const afterOneError = next({ state: { dataUpdateCount: 0, errorUpdateCount: 1 } });
    expect(afterOneError).toBe(next(queryAtTick(1)));
    expect(afterOneError).not.toBe(next(queryAtTick(0)));
  });

  it("returns whole milliseconds", () => {
    const next = jitteredInterval(1234, 0.37);
    for (let tick = 0; tick < 200; tick++) {
      expect(Number.isInteger(next(queryAtTick(tick)))).toBe(true);
    }
  });

  it("collapses to the base when ratio is 0", () => {
    const next = jitteredInterval(2000, 0);
    for (let tick = 0; tick < 50; tick++) expect(next(queryAtTick(tick))).toBe(2000);
  });

  it.each([0, -1, NaN, Infinity])(
    "rejects a base of %s rather than producing a hot timer",
    (base) => {
      expect(() => jitteredInterval(base)).toThrow(RangeError);
    },
  );

  it.each([-0.1, 1, 1.5, NaN, Infinity])("rejects a ratio of %s", (ratio) => {
    expect(() => jitteredInterval(1000, ratio)).toThrow(RangeError);
  });

  it("rejects ratio 1, which would allow a zero-delay tick", () => {
    // The band would be [0, 2·base]; a 0ms refetchInterval is an unthrottled loop.
    expect(() => jitteredInterval(1000, 1)).toThrow(RangeError);
  });

  describe("stability", () => {
    it("returns the same delay for the same fetch count", () => {
      const next = jitteredInterval(1500);
      const first = next(queryAtTick(7));
      for (let i = 0; i < 50; i++) expect(next(queryAtTick(7))).toBe(first);
    });

    it("keeps a query polling across renders faster than its own interval", async () => {
      vi.useFakeTimers();
      const queryFn = vi.fn().mockResolvedValue({ ok: true });

      function Probe({ renderCount }: { renderCount: number }) {
        useQuery({
          queryKey: ["probe"],
          queryFn,
          refetchInterval: jitteredInterval(1000),
          staleTime: 0,
        });
        return <div>{renderCount}</div>;
      }

      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );

      const { rerender } = render(<Probe renderCount={0} />, { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const afterMount = queryFn.mock.calls.length;

      // Render every 400ms of simulated time, well inside the 1000ms poll.
      for (let i = 1; i <= 25; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(400);
        });
        act(() => {
          rerender(<Probe renderCount={i} />);
        });
      }

      // ~10s elapsed at a jittered ~1s interval. A per-render re-roll scores 0.
      expect(queryFn.mock.calls.length - afterMount).toBeGreaterThan(5);
      client.clear();
    });
  });
});

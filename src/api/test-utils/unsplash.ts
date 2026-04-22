import { vi } from "vitest";

import type { UnsplashCoverPayload } from "../../shared/schemas/unsplash";

/**
 * Canonical fixture for an Unsplash cover payload used in cover-image tests.
 * The `id` is parameterised so individual tests can assert on a distinct
 * identifier per scenario.
 */
export function sampleUnsplashPayload(id = "photo-1"): UnsplashCoverPayload {
  return {
    id,
    rawUrl: "https://images.unsplash.com/" + id + "/raw",
    url: "https://images.unsplash.com/" + id,
    thumbUrl: "https://images.unsplash.com/" + id + "/thumb",
    blurHash: "L9ABCD",
    color: "#888888",
    description: "Sample",
    width: 4000,
    height: 3000,
    photoUrl: `https://unsplash.com/photos/${id}?utm_source=cadence-test&utm_medium=referral`,
    downloadLocation: `https://api.unsplash.com/photos/${id}/download?ixid=abc`,
    user: {
      name: "Jane Smith",
      username: "janesmith",
      profileUrl:
        "https://unsplash.com/@janesmith?utm_source=cadence-test&utm_medium=referral",
    },
  };
}

/** Minimal fake PNG File used to exercise the R2 cover-upload path. */
export function fakeCoverPngFile(): File {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
  ]);
  return new File([bytes], "cover.png", { type: "image/png" });
}

export type FetchCall = [input: unknown, init?: unknown];

/**
 * Replaces `globalThis.fetch` with a spy that records every call and always
 * resolves with `{}` and status 200. Returns `{ calls, restore }` — call
 * `restore()` in an `afterEach` / `afterAll` to put the original fetch back.
 *
 * Used by the Unsplash cover tests to assert `trackDownload` hits the photo's
 * `download_location` URL with the `Client-ID` header, without making a real
 * outbound network call.
 */
export function installFetchSpy(): {
  calls: FetchCall[];
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  const spy = vi.fn((input: unknown, init?: unknown) => {
    calls.push([input, init]);
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  globalThis.fetch = spy as unknown as typeof globalThis.fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

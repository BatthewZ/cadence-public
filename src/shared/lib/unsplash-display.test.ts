import { describe, expect, it } from "vitest";

import type {
  StoredUnsplashCoverPayload,
  UnsplashCoverPayload,
} from "../schemas/unsplash";
import {
  buildUnsplashDisplaySrcSet,
  buildUnsplashDisplayUrl,
} from "./unsplash-display";

function makePayload(
  overrides: Partial<UnsplashCoverPayload> = {},
): UnsplashCoverPayload {
  return {
    id: "x",
    rawUrl: "https://images.unsplash.com/photo-1?ixid=abc",
    url: "https://images.unsplash.com/photo-1-regular",
    thumbUrl: "https://images.unsplash.com/photo-1-thumb",
    blurHash: null,
    color: null,
    description: null,
    width: 4000,
    height: 3000,
    photoUrl: "https://unsplash.com/photos/x",
    downloadLocation: "https://api.unsplash.com/photos/x/download",
    user: {
      name: "Jane Doe",
      username: "janedoe",
      profileUrl: "https://unsplash.com/@janedoe",
    },
    ...overrides,
  };
}

describe("buildUnsplashDisplayUrl", () => {
  it("appends cover preset imgix params to rawUrl", () => {
    const url = buildUnsplashDisplayUrl(makePayload(), "cover");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://images.unsplash.com/photo-1",
    );
    expect(parsed.searchParams.get("w")).toBe("1600");
    expect(parsed.searchParams.get("q")).toBe("80");
    expect(parsed.searchParams.get("auto")).toBe("format");
    expect(parsed.searchParams.get("fit")).toBe("max");
    // Preserves the original ixid param that Unsplash uses for tracking.
    expect(parsed.searchParams.get("ixid")).toBe("abc");
  });

  it("appends card preset imgix params to rawUrl", () => {
    const url = buildUnsplashDisplayUrl(makePayload(), "card");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("w")).toBe("500");
    expect(parsed.searchParams.get("q")).toBe("75");
    expect(parsed.searchParams.get("auto")).toBe("format");
    expect(parsed.searchParams.get("fit")).toBe("max");
  });

  it("falls back to `url` for the cover preset when rawUrl is absent (legacy row)", () => {
    // A row that pre-dates rawUrl — at runtime drizzle returns `undefined`
    // for columns not present in the JSON. `StoredUnsplashCoverPayload` (the
    // lenient persistence/read shape) expresses this honestly, so no cast is
    // needed to construct the legacy fixture.
    const legacy: StoredUnsplashCoverPayload = { ...makePayload(), rawUrl: undefined };
    const url = buildUnsplashDisplayUrl(legacy, "cover");
    expect(url).toBe("https://images.unsplash.com/photo-1-regular");
  });

  it("falls back to `thumbUrl` for the card preset when rawUrl is absent", () => {
    const legacy: StoredUnsplashCoverPayload = { ...makePayload(), rawUrl: undefined };
    const url = buildUnsplashDisplayUrl(legacy, "card");
    expect(url).toBe("https://images.unsplash.com/photo-1-thumb");
  });

  it("falls back when rawUrl is not a valid URL", () => {
    const broken = makePayload({ rawUrl: "not a url" });
    expect(buildUnsplashDisplayUrl(broken, "cover")).toBe(
      broken.url,
    );
    expect(buildUnsplashDisplayUrl(broken, "card")).toBe(
      broken.thumbUrl,
    );
  });

  it("overrides existing query params on rawUrl rather than duplicating", () => {
    const payload = makePayload({
      rawUrl: "https://images.unsplash.com/photo-1?w=200&q=10",
    });
    const url = buildUnsplashDisplayUrl(payload, "cover");
    const parsed = new URL(url);
    expect(parsed.searchParams.getAll("w")).toEqual(["1600"]);
    expect(parsed.searchParams.getAll("q")).toEqual(["80"]);
  });
});

describe("buildUnsplashDisplaySrcSet", () => {
  /**
   * The srcset drives responsive cover delivery: modern browsers pick the
   * smallest listed width that satisfies the display (viewport × DPR), so
   * mobile gets 800w and a 4K retina monitor gets 2400w from the same <img>.
   * Breaking this contract regresses either quality or bandwidth.
   */
  it("emits 800 / 1600 / 2400 width descriptors composed from rawUrl", () => {
    const srcset = buildUnsplashDisplaySrcSet(makePayload());
    expect(srcset).not.toBeNull();
    const entries = srcset!.split(", ");
    expect(entries).toHaveLength(3);
    expect(entries[0].endsWith(" 800w")).toBe(true);
    expect(entries[1].endsWith(" 1600w")).toBe(true);
    expect(entries[2].endsWith(" 2400w")).toBe(true);

    // Each URL carries q/auto/fit cover params and the right width.
    for (const entry of entries) {
      const [url, widthDescriptor] = entry.split(" ");
      const parsed = new URL(url);
      const width = widthDescriptor.replace("w", "");
      expect(parsed.searchParams.get("w")).toBe(width);
      expect(parsed.searchParams.get("q")).toBe("80");
      expect(parsed.searchParams.get("auto")).toBe("format");
      expect(parsed.searchParams.get("fit")).toBe("max");
    }
  });

  it("strips an existing `w` param on rawUrl so descriptors don't duplicate", () => {
    const srcset = buildUnsplashDisplaySrcSet(
      makePayload({ rawUrl: "https://images.unsplash.com/photo-1?w=42&ixid=abc" }),
    );
    expect(srcset).not.toBeNull();
    for (const entry of srcset!.split(", ")) {
      const url = entry.split(" ")[0];
      const parsed = new URL(url);
      // Exactly one `w` param, not the stale 42.
      expect(parsed.searchParams.getAll("w")).toHaveLength(1);
      expect(parsed.searchParams.get("w")).not.toBe("42");
      // Preserves ixid (Unsplash's tracking param).
      expect(parsed.searchParams.get("ixid")).toBe("abc");
    }
  });

  it("returns null when rawUrl is absent (legacy row — caller falls back to plain src)", () => {
    const legacy: StoredUnsplashCoverPayload = { ...makePayload(), rawUrl: undefined };
    expect(buildUnsplashDisplaySrcSet(legacy)).toBeNull();
  });

  it("returns null when rawUrl is not a parseable URL", () => {
    expect(
      buildUnsplashDisplaySrcSet(makePayload({ rawUrl: "not a url" })),
    ).toBeNull();
  });
});

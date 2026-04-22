/**
 * Unit tests for the Unsplash service helpers.
 *
 * These tests intentionally exercise the pure pieces (URL normalisation,
 * payload shape) and the critical swallowing guarantee of `trackDownload`.
 * Integration behaviour (auth, rate limit, route plumbing) is covered in
 * `src/api/routes/unsplash/unsplash.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../env";
import {
  appendUtm,
  createUnsplashService,
  type RawUnsplashPhoto,
  toCoverPayload,
  UnsplashError,
} from "./unsplash";

const rawPhoto: RawUnsplashPhoto = {
  id: "abc123",
  width: 4000,
  height: 3000,
  color: "#abcdef",
  blur_hash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  description: "A mountain",
  alt_description: "Mountain in fog",
  urls: {
    raw: "https://images.unsplash.com/raw",
    full: "https://images.unsplash.com/full",
    regular: "https://images.unsplash.com/regular",
    small: "https://images.unsplash.com/small",
    thumb: "https://images.unsplash.com/thumb",
  },
  links: {
    self: "https://api.unsplash.com/photos/abc123",
    html: "https://unsplash.com/photos/abc123",
    download: "https://unsplash.com/photos/abc123/download",
    download_location:
      "https://api.unsplash.com/photos/abc123/download?ixid=XXX",
  },
  user: {
    username: "janesmith",
    name: "Jane Smith",
  },
};

describe("appendUtm", () => {
  it("appends UTM params to a URL with no existing query string", () => {
    const result = appendUtm("https://unsplash.com/@alice", "cadence");
    expect(result).toContain("utm_source=cadence");
    expect(result).toContain("utm_medium=referral");
    // Must use `?` when there are no existing params.
    expect(result.startsWith("https://unsplash.com/@alice?")).toBe(true);
  });

  it("appends UTM params using `&` when the URL already has a query string", () => {
    const result = appendUtm(
      "https://unsplash.com/photos/abc?ixid=deadbeef",
      "cadence",
    );
    expect(result).toContain("ixid=deadbeef");
    expect(result).toContain("utm_source=cadence");
    expect(result).toContain("utm_medium=referral");
    // There must be exactly one `?` separator.
    expect(result.match(/\?/g)?.length).toBe(1);
  });

  it("falls back to manual append when given a non-URL string", () => {
    const result = appendUtm("not a url", "cadence");
    expect(result).toContain("utm_source=cadence");
    expect(result).toContain("utm_medium=referral");
  });
});

describe("toCoverPayload", () => {
  it("normalises a raw Unsplash photo and applies UTM to user-visible URLs", () => {
    const payload = toCoverPayload(rawPhoto, "cadence");
    expect(payload.id).toBe("abc123");
    expect(payload.rawUrl).toBe("https://images.unsplash.com/raw");
    expect(payload.url).toBe("https://images.unsplash.com/regular");
    expect(payload.thumbUrl).toBe("https://images.unsplash.com/thumb");
    expect(payload.blurHash).toBe("LEHV6nWB2yk8pyo0adR*.7kCMdnj");
    expect(payload.color).toBe("#abcdef");
    expect(payload.description).toBe("A mountain");
    expect(payload.width).toBe(4000);
    expect(payload.height).toBe(3000);
    expect(payload.photoUrl).toContain("utm_source=cadence");
    expect(payload.photoUrl).toContain("utm_medium=referral");
    expect(payload.photoUrl.startsWith("https://unsplash.com/photos/abc123?")).toBe(
      true,
    );
    expect(payload.downloadLocation).toBe(rawPhoto.links.download_location);
    expect(payload.user.name).toBe("Jane Smith");
    expect(payload.user.username).toBe("janesmith");
    expect(payload.user.profileUrl).toBe(
      "https://unsplash.com/@janesmith?utm_source=cadence&utm_medium=referral",
    );
  });

  it("falls back to alt_description when description is null", () => {
    const photo: RawUnsplashPhoto = {
      ...rawPhoto,
      description: null,
      alt_description: "alt text",
    };
    const payload = toCoverPayload(photo, "cadence");
    expect(payload.description).toBe("alt text");
  });

  it("preserves nulls for missing optional fields", () => {
    const photo: RawUnsplashPhoto = {
      ...rawPhoto,
      blur_hash: null,
      color: null,
      description: null,
      alt_description: null,
    };
    const payload = toCoverPayload(photo, "cadence");
    expect(payload.blurHash).toBeNull();
    expect(payload.color).toBeNull();
    expect(payload.description).toBeNull();
  });
});

describe("createUnsplashService", () => {
  it("returns null when UNSPLASH_ACCESS_KEY is missing", () => {
    const service = createUnsplashService({} as AppBindings);
    expect(service).toBeNull();
  });

  it("returns null when UNSPLASH_ACCESS_KEY is an empty string", () => {
    const service = createUnsplashService({
      UNSPLASH_ACCESS_KEY: "",
    } as AppBindings);
    expect(service).toBeNull();
  });

  it("returns null when UNSPLASH_ACCESS_KEY is whitespace", () => {
    const service = createUnsplashService({
      UNSPLASH_ACCESS_KEY: "   ",
    } as AppBindings);
    expect(service).toBeNull();
  });

  it("returns a service object when UNSPLASH_ACCESS_KEY is present", () => {
    const service = createUnsplashService({
      UNSPLASH_ACCESS_KEY: "test-key",
    } as AppBindings);
    expect(service).not.toBeNull();
    expect(typeof service?.searchPhotos).toBe("function");
    expect(typeof service?.listCurated).toBe("function");
    expect(typeof service?.trackDownload).toBe("function");
  });
});

describe("UnsplashService.trackDownload", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("swallows fetch rejection and does not throw", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const service = createUnsplashService({
      UNSPLASH_ACCESS_KEY: "test-key",
    } as AppBindings);
    expect(service).not.toBeNull();

    await expect(
      service!.trackDownload(
        "https://api.unsplash.com/photos/abc/download?ixid=xxx",
      ),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
  });

  it("swallows non-OK responses and does not throw", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("forbidden", { status: 403 }));
    const service = createUnsplashService({
      UNSPLASH_ACCESS_KEY: "test-key",
    } as AppBindings);

    await expect(
      service!.trackDownload(
        "https://api.unsplash.com/photos/abc/download?ixid=xxx",
      ),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
  });

  it("completes normally on OK response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ url: "ok" })));
    const service = createUnsplashService({
      UNSPLASH_ACCESS_KEY: "test-key",
    } as AppBindings);

    await expect(
      service!.trackDownload(
        "https://api.unsplash.com/photos/abc/download?ixid=xxx",
      ),
    ).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("UnsplashError", () => {
  it("carries the upstream status", () => {
    const err = new UnsplashError("boom", 403);
    expect(err.status).toBe(403);
    expect(err.message).toBe("boom");
    expect(err.name).toBe("UnsplashError");
    expect(err).toBeInstanceOf(Error);
  });
});

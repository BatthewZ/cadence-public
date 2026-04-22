import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnsplashCoverPayload } from "@/shared/schemas/unsplash";

// Mock the api client module following the established pattern.
vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>(
    "@/web/lib/api/client",
  );
  return {
    ...actual,
    api: Object.assign(vi.fn(), {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

import { api } from "@/web/lib/api/client";

import { useProjectCover } from "./use-project-cover";

const mockPut = api.put as ReturnType<typeof vi.fn>;
const mockDelete = api.delete as ReturnType<typeof vi.fn>;

/**
 * Tests for the cover-URL / attribution derivation and Unsplash-apply
 * optimistic-contract in `useProjectCover`. These guarantee that the XOR
 * invariant (uploadedKey XOR unsplashPayload) is mirrored optimistically —
 * a regression here causes UI to flash "both covers" during mutations.
 */

const SAMPLE_PAYLOAD: UnsplashCoverPayload = {
  id: "photo-1",
  rawUrl: "https://images.unsplash.com/raw.jpg",
  url: "https://images.unsplash.com/full.jpg",
  thumbUrl: "https://images.unsplash.com/thumb.jpg",
  blurHash: null,
  color: "#112233",
  description: "A photograph",
  width: 1920,
  height: 1080,
  photoUrl: "https://unsplash.com/photos/photo-1",
  downloadLocation: "https://api.unsplash.com/photos/photo-1/download",
  user: {
    name: "Jane Doe",
    username: "janedoe",
    profileUrl: "https://unsplash.com/@janedoe",
  },
};

describe("useProjectCover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves coverUrl from the Unsplash payload when set", () => {
    const updateProject = vi.fn();
    const { result } = renderHook(() =>
      useProjectCover("p1", null, SAMPLE_PAYLOAD, updateProject),
    );

    // coverUrl is now composed from rawUrl via buildUnsplashDisplayUrl's
    // "cover" preset, not the pre-baked regular URL.
    const parsed = new URL(result.current.coverUrl!);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://images.unsplash.com/raw.jpg",
    );
    expect(parsed.searchParams.get("w")).toBe("1600");
    expect(parsed.searchParams.get("auto")).toBe("format");
    expect(result.current.coverAttribution).toEqual({
      name: "Jane Doe",
      username: "janedoe",
      profileUrl: "https://unsplash.com/@janedoe",
      photoUrl: "https://unsplash.com/photos/photo-1",
    });
  });

  it("falls back to the uploaded key when no Unsplash payload is set", () => {
    const updateProject = vi.fn();
    const { result } = renderHook(() =>
      useProjectCover("p1", "abc/def.png", null, updateProject),
    );

    expect(result.current.coverUrl).toBe("/api/uploads/abc/def.png");
    expect(result.current.coverAttribution).toBeNull();
  });

  it("returns null URL and attribution when no cover is set", () => {
    const updateProject = vi.fn();
    const { result } = renderHook(() =>
      useProjectCover("p1", null, null, updateProject),
    );

    expect(result.current.coverUrl).toBeNull();
    expect(result.current.coverAttribution).toBeNull();
  });

  it("applies optimistic XOR update and PUTs the Unsplash payload", async () => {
    const updateProject = vi.fn();
    mockPut.mockResolvedValueOnce({ coverUnsplash: SAMPLE_PAYLOAD });

    const { result } = renderHook(() =>
      useProjectCover("p1", "existing-key", null, updateProject),
    );

    await act(async () => {
      await result.current.handleApplyUnsplash(SAMPLE_PAYLOAD);
    });

    // Optimistic: clears coverImageKey AND sets coverUnsplash (XOR invariant).
    expect(updateProject).toHaveBeenCalledWith({
      coverImageKey: null,
      coverUnsplash: SAMPLE_PAYLOAD,
    });
    expect(mockPut).toHaveBeenCalledWith(
      "/api/projects/p1/cover/unsplash",
      SAMPLE_PAYLOAD,
    );
  });

  it("fires onApplyError when the Unsplash PUT fails", async () => {
    const updateProject = vi.fn();
    const onApplyError = vi.fn();
    mockPut.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() =>
      useProjectCover("p1", null, null, updateProject, undefined, onApplyError),
    );

    await act(async () => {
      await result.current.handleApplyUnsplash(SAMPLE_PAYLOAD);
    });

    await waitFor(() => {
      expect(onApplyError).toHaveBeenCalledTimes(1);
    });
    // Optimistic update still happened — caller is responsible for refetch.
    expect(updateProject).toHaveBeenCalledWith({
      coverImageKey: null,
      coverUnsplash: SAMPLE_PAYLOAD,
    });
  });

  it("clears both cover fields on remove", async () => {
    const updateProject = vi.fn();
    mockDelete.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useProjectCover("p1", "existing-key", SAMPLE_PAYLOAD, updateProject),
    );

    await act(async () => {
      await result.current.handleRemove();
    });

    expect(updateProject).toHaveBeenCalledWith({
      coverImageKey: null,
      coverUnsplash: null,
    });
    expect(mockDelete).toHaveBeenCalledWith("/api/projects/p1/cover");
  });
});

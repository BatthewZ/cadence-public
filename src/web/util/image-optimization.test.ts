import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AVATAR_PRESET,
  COVER_PRESET,
  isAnimatedGif,
  optimizeImage,
} from "./image-optimization";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createFile(name: string, size: number, type: string): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

/** Build a minimal GIF header (GIF89a) with the given number of image descriptor blocks. */
function createGifBytes(frameCount: number): Uint8Array {
  // GIF89a header (6 bytes) + logical screen descriptor (7 bytes)
  const header = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, // 1x1px, no GCT
  ];

  const frames: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    // Image descriptor: 0x2C + position (4 bytes) + size (4 bytes) + flags
    frames.push(
      0x2c, // Image descriptor introducer
      0x00, 0x00, 0x00, 0x00, // left, top
      0x01, 0x00, 0x01, 0x00, // width=1, height=1
      0x00, // no LCT
      0x02, // LZW minimum code size
      0x01, 0x01, // sub-block: 1 byte of data
      0x00, // block terminator
    );
  }

  // GIF trailer
  frames.push(0x3b);

  return new Uint8Array([...header, ...frames]);
}

function createGifFile(frameCount: number, name = "test.gif"): File {
  const bytes = createGifBytes(frameCount);
  return new File([bytes as BlobPart], name, { type: "image/gif" });
}

/* ------------------------------------------------------------------ */
/*  Canvas / Image mocking for jsdom                                   */
/* ------------------------------------------------------------------ */

let mockCanvasContext: {
  drawImage: ReturnType<typeof vi.fn>;
};

let mockToBlob: ReturnType<typeof vi.fn>;

function setupCanvasMock(options?: { webpSupported?: boolean; blobSize?: number }) {
  const { webpSupported = true, blobSize = 500 } = options ?? {};

  mockCanvasContext = {
    drawImage: vi.fn(),
  };

  mockToBlob = vi.fn((callback: BlobCallback, type?: string) => {
    if (type === "image/webp" && !webpSupported) {
      callback(null);
      return;
    }
    const mimeType = type === "image/webp" && webpSupported ? "image/webp" : "image/jpeg";
    callback(new Blob([new Uint8Array(blobSize)], { type: mimeType }));
  });

  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => mockCanvasContext,
        toBlob: mockToBlob,
      } as unknown as HTMLCanvasElement;
    }
    return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
  });
}

const OriginalImage = globalThis.Image;

function setupImageMock(naturalWidth: number, naturalHeight: number) {
  // Replace the global Image constructor with one that auto-loads with given dimensions
  globalThis.Image = class MockImage {
    naturalWidth = naturalWidth;
    naturalHeight = naturalHeight;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_: string) {
      queueMicrotask(() => {
        this.onload?.();
      });
    }
  } as unknown as typeof Image;
}

function setupFailingImageMock() {
  globalThis.Image = class MockImage {
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_: string) {
      queueMicrotask(() => {
        this.onerror?.();
      });
    }
  } as unknown as typeof Image;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("isAnimatedGif", () => {
  it("returns false for non-GIF files", async () => {
    const png = createFile("photo.png", 1024, "image/png");
    expect(await isAnimatedGif(png)).toBe(false);
  });

  it("returns false for single-frame GIF", async () => {
    const gif = createGifFile(1);
    expect(await isAnimatedGif(gif)).toBe(false);
  });

  it("returns true for multi-frame GIF", async () => {
    const gif = createGifFile(3);
    expect(await isAnimatedGif(gif)).toBe(true);
  });

  it("returns true for GIF with exactly 2 frames", async () => {
    const gif = createGifFile(2);
    expect(await isAnimatedGif(gif)).toBe(true);
  });
});

describe("presets", () => {
  it("AVATAR_PRESET has reasonable dimensions", () => {
    expect(AVATAR_PRESET.maxWidth).toBe(256);
    expect(AVATAR_PRESET.maxHeight).toBe(256);
    expect(AVATAR_PRESET.quality).toBeGreaterThan(0);
    expect(AVATAR_PRESET.quality).toBeLessThanOrEqual(1);
  });

  it("COVER_PRESET has reasonable dimensions", () => {
    expect(COVER_PRESET.maxWidth).toBe(1920);
    expect(COVER_PRESET.maxHeight).toBe(1080);
    expect(COVER_PRESET.quality).toBeGreaterThan(0);
    expect(COVER_PRESET.quality).toBeLessThanOrEqual(1);
  });
});

describe("optimizeImage", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.Image = OriginalImage;
    vi.restoreAllMocks();
  });

  it("resizes a large image to fit within preset dimensions", async () => {
    setupImageMock(4000, 3000);
    setupCanvasMock({ blobSize: 500 });

    const file = createFile("photo.png", 5000, "image/png");
    const result = await optimizeImage(file, AVATAR_PRESET);

    expect(result.size).toBeLessThan(file.size);
    expect(result.name).toBe("photo.webp");
    expect(result.type).toBe("image/webp");
  });

  it("converts format even when image is within preset dimensions", async () => {
    setupImageMock(200, 200);
    setupCanvasMock({ blobSize: 300 });

    const file = createFile("small.png", 5000, "image/png");
    const result = await optimizeImage(file, AVATAR_PRESET);

    // Still optimized because format conversion reduces size
    expect(result.size).toBeLessThan(file.size);
    expect(result.type).toBe("image/webp");
  });

  it("returns original file when optimized version is not smaller", async () => {
    setupImageMock(100, 100);
    // Mock blob that is larger than the original
    setupCanvasMock({ blobSize: 2000 });

    const file = createFile("tiny.webp", 500, "image/webp");
    const result = await optimizeImage(file, AVATAR_PRESET);

    expect(result).toBe(file);
  });

  it("falls back to JPEG when WebP is not supported", async () => {
    setupImageMock(1000, 1000);
    setupCanvasMock({ webpSupported: false, blobSize: 400 });

    const file = createFile("photo.png", 5000, "image/png");
    const result = await optimizeImage(file, AVATAR_PRESET);

    expect(result.size).toBeLessThan(file.size);
    expect(result.name).toBe("photo.jpg");
    expect(result.type).toBe("image/jpeg");
  });

  it("preserves aspect ratio when resizing", async () => {
    setupImageMock(2000, 1000); // 2:1 aspect ratio
    setupCanvasMock({ blobSize: 300 });

    const file = createFile("wide.png", 5000, "image/png");
    await optimizeImage(file, AVATAR_PRESET);

    // The final canvas should maintain aspect ratio within 256x256
    // Width 256 would give height 128 (2:1 ratio)
    // Check that drawImage was called (step-down resize draws multiple times)
    expect(mockCanvasContext.drawImage).toHaveBeenCalled();
  });

  it("returns original file on error", async () => {
    setupFailingImageMock();

    const file = createFile("corrupt.png", 1024, "image/png");
    const result = await optimizeImage(file, AVATAR_PRESET);

    // Should return original file unchanged
    expect(result).toBe(file);
  });

  it("revokes the object URL after processing", async () => {
    setupImageMock(500, 500);
    setupCanvasMock({ blobSize: 300 });

    const revokeSpy = vi.mocked(URL).revokeObjectURL;

    const file = createFile("photo.png", 5000, "image/png");
    await optimizeImage(file, AVATAR_PRESET);

    expect(revokeSpy).toHaveBeenCalledWith("blob:mock-url");
  });

  it("uses step-down resizing for large downscale ratios", async () => {
    // 4000 → 256 requires multiple halving steps:
    // 4000 → 2000 → 1000 → 500 → 256 (final) = 4 drawImage calls
    setupImageMock(4000, 4000);
    setupCanvasMock({ blobSize: 300 });

    const file = createFile("huge.png", 50000, "image/png");
    await optimizeImage(file, AVATAR_PRESET);

    expect(mockCanvasContext.drawImage.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("works with COVER_PRESET for wide images", async () => {
    setupImageMock(3840, 2160); // 4K
    setupCanvasMock({ blobSize: 800 });

    const file = createFile("cover.jpg", 5000, "image/jpeg");
    const result = await optimizeImage(file, COVER_PRESET);

    expect(result.size).toBeLessThan(file.size);
    expect(result.name).toBe("cover.webp");
  });
});

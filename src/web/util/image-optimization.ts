/**
 * Client-side image optimization.
 *
 * Resizes and converts images to WebP (with JPEG fallback) before upload,
 * dramatically reducing file size for avatars and cover images that display
 * at much smaller dimensions than users typically upload.
 */

/* ------------------------------------------------------------------ */
/*  Types & Presets                                                     */
/* ------------------------------------------------------------------ */

export interface ImagePreset {
  /** Maximum width in pixels. */
  maxWidth: number;
  /** Maximum height in pixels. */
  maxHeight: number;
  /** Output quality 0-1. */
  quality: number;
}

/** Avatars display at max 64px (xl). 256px covers 4x retina. */
export const AVATAR_PRESET: ImagePreset = {
  maxWidth: 256,
  maxHeight: 256,
  quality: 0.85,
};

/** Covers display at 128-160px tall, full container width. 1920px covers 2x on 1080p. */
export const COVER_PRESET: ImagePreset = {
  maxWidth: 1920,
  maxHeight: 1080,
  quality: 0.82,
};

/* ------------------------------------------------------------------ */
/*  Animated GIF detection                                             */
/* ------------------------------------------------------------------ */

/**
 * Detects whether a GIF file contains multiple frames (is animated).
 *
 * Scans for GIF image descriptor markers (byte `0x2C` preceded by certain
 * block terminators). Two or more image descriptors means animation.
 * Only reads the first 64KB to keep it fast.
 */
export async function isAnimatedGif(file: File): Promise<boolean> {
  if (file.type !== "image/gif") return false;

  const chunkSize = Math.min(file.size, 64 * 1024);
  const buffer = await file.slice(0, chunkSize).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // A GIF image descriptor block starts with 0x2C.
  // Count how many image descriptors exist — 2+ means animated.
  let imageDescriptors = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x2c) {
      imageDescriptors++;
      if (imageDescriptors >= 2) return true;
    }
  }

  return false;
}

/* ------------------------------------------------------------------ */
/*  Image loading                                                      */
/* ------------------------------------------------------------------ */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

/* ------------------------------------------------------------------ */
/*  Step-down resize                                                   */
/* ------------------------------------------------------------------ */

/**
 * Draws `source` onto a canvas at `targetWidth x targetHeight` using step-down
 * resizing — halving dimensions iteratively before the final draw. This avoids
 * the blurriness that comes from a single large-to-small downscale in Canvas.
 */
function stepDownResize(
  source: HTMLImageElement | HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  let currentWidth = "naturalWidth" in source ? source.naturalWidth : source.width;
  let currentHeight = "naturalHeight" in source ? source.naturalHeight : source.height;
  let currentSource: HTMLImageElement | HTMLCanvasElement = source;

  // Iteratively halve until we're within 2x of the target in both dimensions
  while (currentWidth / 2 > targetWidth || currentHeight / 2 > targetHeight) {
    const nextWidth = Math.max(Math.round(currentWidth / 2), targetWidth);
    const nextHeight = Math.max(Math.round(currentHeight / 2), targetHeight);

    const step = document.createElement("canvas");
    step.width = nextWidth;
    step.height = nextHeight;

    const ctx = step.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas 2d context");

    ctx.drawImage(currentSource, 0, 0, nextWidth, nextHeight);
    currentSource = step;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  // Final draw at exact target dimensions
  const final = document.createElement("canvas");
  final.width = targetWidth;
  final.height = targetHeight;

  const ctx = final.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas 2d context");

  ctx.drawImage(currentSource, 0, 0, targetWidth, targetHeight);
  return final;
}

/* ------------------------------------------------------------------ */
/*  Canvas → File export                                               */
/* ------------------------------------------------------------------ */

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * Exports a canvas to a File, trying WebP first with JPEG fallback.
 * Returns the file and its MIME type.
 */
async function exportCanvas(
  canvas: HTMLCanvasElement,
  originalName: string,
  quality: number,
): Promise<File> {
  const baseName = originalName.replace(/\.[^.]+$/, "");

  // Try WebP first
  const webpBlob = await canvasToBlob(canvas, "image/webp", quality);
  if (webpBlob && webpBlob.type === "image/webp") {
    return new File([webpBlob], `${baseName}.webp`, { type: "image/webp" });
  }

  // Fallback to JPEG
  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", quality);
  if (jpegBlob) {
    return new File([jpegBlob], `${baseName}.jpg`, { type: "image/jpeg" });
  }

  throw new Error("Canvas export failed for both WebP and JPEG");
}

/* ------------------------------------------------------------------ */
/*  Main optimization function                                         */
/* ------------------------------------------------------------------ */

/**
 * Optimizes an image file by resizing it to fit within the preset dimensions
 * and converting to WebP (or JPEG as fallback).
 *
 * - Animated GIFs are returned as-is (call `isAnimatedGif` separately to check).
 * - If the image is already smaller than the preset, it is still re-encoded
 *   for format conversion (PNG → WebP saves significant size).
 * - On any error, the original file is returned unchanged.
 */
export async function optimizeImage(file: File, preset: ImagePreset): Promise<File> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await loadImage(objectUrl);
    const { naturalWidth, naturalHeight } = img;

    // Calculate target dimensions preserving aspect ratio
    let targetWidth = naturalWidth;
    let targetHeight = naturalHeight;

    if (targetWidth > preset.maxWidth || targetHeight > preset.maxHeight) {
      const widthRatio = preset.maxWidth / targetWidth;
      const heightRatio = preset.maxHeight / targetHeight;
      const ratio = Math.min(widthRatio, heightRatio);

      targetWidth = Math.round(targetWidth * ratio);
      targetHeight = Math.round(targetHeight * ratio);
    }

    // Use step-down resize for quality
    const canvas = stepDownResize(img, targetWidth, targetHeight);
    const optimized = await exportCanvas(canvas, file.name, preset.quality);

    // Only use the optimized version if it's actually smaller
    if (optimized.size < file.size) {
      return optimized;
    }

    return file;
  } catch {
    // On any failure, return the original file unchanged
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

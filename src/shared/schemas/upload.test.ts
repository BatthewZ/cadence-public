import { describe, expect, it } from "vitest";

import {
  ALLOWED_IMAGE_TYPES,
  avatarUploadSchema,
  MAX_AVATAR_SIZE,
  MAX_UPLOAD_SIZE,
  uploadSchema,
} from "./upload";

describe("upload constants", () => {
  it("ALLOWED_IMAGE_TYPES contains exactly jpeg, png, gif, webp", () => {
    expect(ALLOWED_IMAGE_TYPES).toEqual([
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ]);
  });

  it("MAX_AVATAR_SIZE is 2MB", () => {
    expect(MAX_AVATAR_SIZE).toBe(2 * 1024 * 1024);
  });

  it("MAX_UPLOAD_SIZE is 5MB", () => {
    expect(MAX_UPLOAD_SIZE).toBe(5 * 1024 * 1024);
  });
});

describe("avatarUploadSchema", () => {
  it("accepts a valid image file", () => {
    const file = new File(["content"], "test.jpg", { type: "image/jpeg" });
    const result = avatarUploadSchema.safeParse({ file });
    expect(result.success).toBe(true);
  });

  it("accepts all allowed image types", () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      const file = new File(["content"], "test.img", { type });
      const result = avatarUploadSchema.safeParse({ file });
      expect(result.success).toBe(true);
    }
  });

  it("rejects non-image file type", () => {
    const file = new File(["content"], "test.txt", { type: "text/plain" });
    const result = avatarUploadSchema.safeParse({ file });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "File must be a JPEG, PNG, GIF, or WebP image",
      );
    }
  });

  it("rejects file exceeding MAX_AVATAR_SIZE", () => {
    const file = new File([new ArrayBuffer(3 * 1024 * 1024)], "big.jpg", {
      type: "image/jpeg",
    });
    const result = avatarUploadSchema.safeParse({ file });
    expect(result.success).toBe(false);
    if (!result.success) {
      const sizeError = result.error.issues.find((i) =>
        i.message.includes("2MB"),
      );
      expect(sizeError).toBeDefined();
    }
  });

  it("rejects non-File input", () => {
    const result = avatarUploadSchema.safeParse({ file: "not-a-file" });
    expect(result.success).toBe(false);
  });
});

describe("uploadSchema", () => {
  it("accepts a valid file under MAX_UPLOAD_SIZE", () => {
    const file = new File(["content"], "document.pdf", {
      type: "application/pdf",
    });
    const result = uploadSchema.safeParse({ file });
    expect(result.success).toBe(true);
  });

  it("rejects file exceeding MAX_UPLOAD_SIZE", () => {
    const file = new File(
      [new ArrayBuffer(6 * 1024 * 1024)],
      "big-file.bin",
      { type: "application/octet-stream" },
    );
    const result = uploadSchema.safeParse({ file });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "File must be smaller than 5MB",
      );
    }
  });

  it("rejects non-File input", () => {
    const result = uploadSchema.safeParse({ file: 12345 });
    expect(result.success).toBe(false);
  });
});

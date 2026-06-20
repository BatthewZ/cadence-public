/** True when a MIME type represents a previewable image (renders inline / in the lightbox). */
export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

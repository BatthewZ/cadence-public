/**
 * Detects MIME type from file content by checking magic bytes (file signatures).
 * Returns the detected MIME type, or null if the content doesn't match any
 * known signature. This is used as a server-side validation layer to ensure
 * the client-provided MIME type isn't spoofed — preventing attackers from
 * uploading malicious content (e.g. HTML) disguised as an allowed type.
 */

type MagicSignature = {
  bytes: number[];
  offset?: number;
  mime: string;
};

const SIGNATURES: MagicSignature[] = [
  // Images
  { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: "image/png" },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: "image/gif" }, // GIF87a or GIF89a
  // WebP: starts with RIFF....WEBP
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: "_riff" }, // RIFF container, needs further check
  // PDF
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf" }, // %PDF
  // ZIP-based formats (ZIP, DOCX, XLSX, PPTX)
  { bytes: [0x50, 0x4b, 0x03, 0x04], mime: "_zip" }, // PK.. — needs further classification
  // Legacy Office formats (OLE2 Compound Document)
  { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], mime: "_ole2" },
];

function matchesBytes(data: Uint8Array, sig: MagicSignature): boolean {
  const offset = sig.offset ?? 0;
  if (data.length < offset + sig.bytes.length) return false;
  return sig.bytes.every((b, i) => data[offset + i] === b);
}

/**
 * ZIP-based Office formats (docx, xlsx, pptx) have a specific content_types
 * entry. We check for the [Content_Types].xml marker that all OOXML files have,
 * and for the specific content type strings within.
 */
function classifyZip(data: Uint8Array): string {
  // Convert enough bytes to search for OOXML markers
  const searchLen = Math.min(data.length, 8000);
  const text = new TextDecoder("ascii", { fatal: false }).decode(
    data.subarray(0, searchLen),
  );

  if (text.includes("word/")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (text.includes("xl/")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (text.includes("ppt/")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  // Generic ZIP
  return "application/zip";
}

function classifyOle2(data: Uint8Array): string {
  // OLE2 files (.doc, .xls, .ppt) have internal stream markers
  const searchLen = Math.min(data.length, 8000);
  const text = new TextDecoder("ascii", { fatal: false }).decode(
    data.subarray(0, searchLen),
  );

  if (text.includes("Word.Document") || text.includes("W\0o\0r\0d")) return "application/msword";
  if (text.includes("Microsoft Excel") || text.includes("Workbook")) return "application/vnd.ms-excel";
  if (text.includes("PowerPoint") || text.includes("P\0o\0w\0e\0r")) return "application/vnd.ms-powerpoint";

  // Default to msword for unrecognized OLE2 (most common legacy format)
  return "application/msword";
}

function classifyRiff(data: Uint8Array): string | null {
  // RIFF....WEBP
  if (data.length >= 12 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

/**
 * Text-based formats (plain text, CSV, markdown) don't have magic bytes.
 * We validate by checking that the content is valid UTF-8 text and doesn't
 * contain suspicious HTML/script patterns.
 */
function isPlausibleText(data: Uint8Array): boolean {
  // Check first 1KB for non-text binary bytes
  const checkLen = Math.min(data.length, 1024);
  for (let i = 0; i < checkLen; i++) {
    const byte = data[i];
    // Allow printable ASCII, tabs, newlines, carriage returns, and UTF-8 continuation bytes
    if (byte < 0x09) return false;
    if (byte > 0x0d && byte < 0x20 && byte !== 0x1b) return false;
  }
  return true;
}

/**
 * Check if text content contains patterns that indicate it's actually
 * HTML/JavaScript rather than plain text. Prevents XSS via text file upload.
 */
function containsHtmlPatterns(data: Uint8Array): boolean {
  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(data.subarray(0, Math.min(data.length, 4096)))
    .toLowerCase();

  return (
    text.includes("<script") ||
    text.includes("<html") ||
    text.includes("<!doctype") ||
    text.includes("<svg") ||
    text.includes("javascript:")
  );
}

export function detectMimeType(
  buffer: ArrayBuffer,
  claimedType: string,
): string | null {
  const data = new Uint8Array(buffer);
  if (data.length === 0) return null;

  // Check binary signatures first
  for (const sig of SIGNATURES) {
    if (matchesBytes(data, sig)) {
      if (sig.mime === "_riff") {
        return classifyRiff(data);
      }
      if (sig.mime === "_zip") {
        return classifyZip(data);
      }
      if (sig.mime === "_ole2") {
        return classifyOle2(data);
      }
      return sig.mime;
    }
  }

  // Text-based formats: validate content is actually text
  const textTypes = ["text/plain", "text/csv", "text/markdown"];
  if (textTypes.includes(claimedType)) {
    if (!isPlausibleText(data)) return null;
    if (containsHtmlPatterns(data)) return null;
    return claimedType;
  }

  return null;
}

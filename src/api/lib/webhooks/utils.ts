import { webhook } from "../../../db/schema/webhook";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebhookRow = typeof webhook.$inferSelect;

type ValidateUrlResult =
  | { valid: true }
  | { valid: false; error: string };

// ---------------------------------------------------------------------------
// generateWebhookSecret
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically secure 256-bit webhook secret.
 *
 * Uses Web Crypto API (`crypto.getRandomValues`) which is available in
 * Cloudflare Workers. Returns a 64-character hex string.
 */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// validateWebhookUrl
// ---------------------------------------------------------------------------

/** Private IP / reserved address ranges that must be blocked (SSRF). */
const PRIVATE_IP_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // link-local / cloud metadata
  /^0\.0\.0\.0$/, // unspecified
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

/**
 * Validate a webhook URL with SSRF protection.
 *
 * Enforces HTTPS-only and rejects private/reserved addresses so that
 * user-supplied webhook endpoints cannot reach internal infrastructure.
 */
export function validateWebhookUrl(
  url: string,
  opts?: { allowInsecure?: boolean },
): ValidateUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (parsed.protocol !== "https:" && !opts?.allowInsecure) {
    return { valid: false, error: "URL must use HTTPS" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { valid: false, error: "URL must use HTTPS or HTTP" };
  }

  // In dev mode, skip hostname/IP restrictions to allow localhost testing
  if (opts?.allowInsecure) {
    return { valid: true };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: "URL must not point to a local or loopback address" };
  }

  // Reject *.local hostnames (mDNS / Bonjour)
  if (hostname.endsWith(".local")) {
    return { valid: false, error: "URL must not point to a .local address" };
  }

  // Check against private IP ranges
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, error: "URL must not point to a private or reserved IP address" };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// signPayload
// ---------------------------------------------------------------------------

/**
 * Compute an HMAC-SHA256 signature over the payload using Web Crypto API.
 *
 * Returns a hex-encoded signature string suitable for the
 * `X-Webhook-Signature` header (`sha256=<hex>`).
 */
export async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

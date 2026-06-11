import type { Context } from "hono";

import { webhook } from "../../../db/schema/webhook";
import type { AppEnv } from "../../env";

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

/** Private IPv4 ranges that must be blocked (SSRF). Checked against a
 *  dotted-decimal canonical form, so non-standard encodings (decimal int,
 *  hex int, octal-prefixed parts) are first normalised. */
const PRIVATE_IPV4_PATTERNS = [
  /^127\./, // 127.0.0.0/8 — loopback
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // link-local / cloud metadata (AWS/GCP IMDS)
  /^0\.0\.0\.0$/, // unspecified
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 — CGNAT
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "::",
]);

/**
 * Try to canonicalise a hostname that looks like an IPv4 address into
 * dotted-decimal form. Returns `null` when the hostname is not numeric.
 *
 * Why this matters: `validateWebhookUrl` checks the textual hostname
 * against regex patterns for private ranges, so non-standard IPv4
 * encodings (decimal `2130706433`, hex `0x7f000001`, octal `0177.0.0.1`,
 * or short forms like `127.1`) bypass the regex even though the IP
 * resolves to a private/loopback address.
 *
 * Strategy:
 *  - Single all-digit number → 32-bit unsigned, big-endian split
 *  - Single `0x...` hex token → 32-bit unsigned, big-endian split
 *  - 1-3 dotted parts (e.g. `127.1`) → pad with zeros (`127.0.0.1`)
 *  - 4 dotted parts → normalise each part (hex/octal/decimal allowed)
 *
 * Returns null when the hostname is clearly not an IPv4 (contains
 * letters, colons, etc. that aren't part of a known numeric form). The
 * caller then treats the hostname as a DNS name and runs the rest of the
 * checks normally.
 */
function canonicaliseIPv4(hostname: string): string | null {
  const h = hostname.toLowerCase();

  // Single decimal integer (e.g. "2130706433" = 127.0.0.1).
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    if (!Number.isFinite(n) || n < 0 || n > 0xff_ff_ff_ff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
  }

  // Single hex integer (e.g. "0x7f000001" = 127.0.0.1).
  if (/^0x[0-9a-f]+$/.test(h)) {
    const n = parseInt(h, 16);
    if (!Number.isFinite(n) || n < 0 || n > 0xff_ff_ff_ff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
  }

  // Dotted form. Accept 1-4 parts where each part is decimal, hex (0x...)
  // or octal (leading 0). Reject anything else.
  const parts = h.split(".");
  if (parts.length < 1 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const p of parts) {
    if (p.length === 0) return null;
    let n: number;
    if (/^0x[0-9a-f]+$/.test(p)) {
      n = parseInt(p, 16);
    } else if (/^0[0-7]+$/.test(p)) {
      n = parseInt(p, 8);
    } else if (/^[0-9]+$/.test(p)) {
      n = parseInt(p, 10);
    } else {
      // Not a numeric IPv4 component — bail and treat the hostname as DNS.
      return null;
    }
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }

  // Expand short forms: 1-part is single int (already handled above by the
  // /^\d+$/ branch, but cover the dotted edge case); 2-part is `a.b` where
  // b spans the last 24 bits; 3-part is `a.b.c` where c spans 16 bits.
  // 4-part is the standard form — every part must fit in 8 bits.
  if (nums.length === 4) {
    if (nums.some((n) => n > 0xff)) return null;
    return nums.join(".");
  }
  if (nums.length === 1) {
    const n = nums[0];
    if (n > 0xff_ff_ff_ff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
  }
  if (nums.length === 2) {
    const [a, b] = nums;
    if (a > 0xff || b > 0xff_ff_ff) return null;
    return [a, (b >>> 16) & 0xff, (b >>> 8) & 0xff, b & 0xff].join(".");
  }
  if (nums.length === 3) {
    const [a, b, c] = nums;
    if (a > 0xff || b > 0xff || c > 0xff_ff) return null;
    return [a, b, (c >>> 8) & 0xff, c & 0xff].join(".");
  }
  return null;
}

/**
 * Returns true when an IPv6 address falls in a range we must not let a
 * user-supplied webhook reach. Covers loopback (`::1`), unspecified
 * (`::`), unique local addresses (`fc00::/7` → `fc..` / `fd..`),
 * link-local (`fe80::/10` → `fe80::`–`febf::`), and IPv4-mapped IPv6
 * (`::ffff:a.b.c.d` or `::ffff:hex:hex`) where we re-check the embedded
 * IPv4 against the IPv4 private ranges.
 *
 * Accepts the hostname WITHOUT the URL brackets — caller must strip them.
 */
function isBlockedIPv6(hostname: string): { blocked: true; reason: string } | { blocked: false } {
  const h = hostname.toLowerCase();
  if (!h.includes(":")) return { blocked: false };

  // Exact-match loopback / unspecified handled by the caller's BLOCKED set
  // too, but we re-check here so the function is self-contained.
  if (h === "::1" || h === "::") {
    return { blocked: true, reason: "URL must not point to a local or loopback address" };
  }

  // IPv4-mapped IPv6 (e.g. `::ffff:127.0.0.1` or `::ffff:7f00:1`).
  // The dotted form embeds a literal IPv4 we can re-check directly.
  const mappedDotted = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) {
    const canonical = canonicaliseIPv4(mappedDotted[1]);
    if (!canonical) {
      return { blocked: true, reason: "URL contains a malformed IPv4-mapped IPv6 address" };
    }
    return ipv4PrivateCheck(canonical);
  }
  // The hex form (`::ffff:7f00:1`) is two 16-bit groups encoding the four
  // IPv4 octets. Convert and re-check.
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    if (
      !Number.isFinite(high) || !Number.isFinite(low) ||
      high < 0 || high > 0xffff || low < 0 || low > 0xffff
    ) {
      return { blocked: true, reason: "URL contains a malformed IPv4-mapped IPv6 address" };
    }
    const canonical = [(high >>> 8) & 0xff, high & 0xff, (low >>> 8) & 0xff, low & 0xff].join(".");
    return ipv4PrivateCheck(canonical);
  }

  // Unique-local addresses fc00::/7 → first byte 0xfc or 0xfd.
  // Link-local fe80::/10 → first 10 bits are 1111_1110_10, which in hex
  // means the first hextet starts with `fe8`, `fe9`, `fea`, or `feb`.
  if (/^fc[0-9a-f]{0,2}:/.test(h) || /^fd[0-9a-f]{0,2}:/.test(h)) {
    return { blocked: true, reason: "URL must not point to a private or reserved IP address" };
  }
  if (/^fe[89ab][0-9a-f]?:/.test(h)) {
    return { blocked: true, reason: "URL must not point to a private or reserved IP address" };
  }

  return { blocked: false };
}

function ipv4PrivateCheck(canonicalIpv4: string): { blocked: true; reason: string } | { blocked: false } {
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(canonicalIpv4)) {
      return { blocked: true, reason: "URL must not point to a private or reserved IP address" };
    }
  }
  return { blocked: false };
}

/**
 * Validate a webhook URL with SSRF protection.
 *
 * Enforces HTTPS-only and rejects:
 *  - Plain hostnames `localhost`, `[::1]`, `0.0.0.0`, etc.
 *  - All RFC 1918 private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12,
 *    192.168.0.0/16), the link-local range used by cloud metadata
 *    endpoints (169.254.0.0/16 — AWS IMDS, GCP), CGNAT (100.64.0.0/10),
 *    and the loopback range (127.0.0.0/8).
 *  - Non-standard IPv4 encodings (`http://2130706433/`, `http://0x7f.1/`,
 *    `http://0177.0.0.1/`) — canonicalised before checking so the same
 *    private-range rules apply.
 *  - IPv6 loopback (`::1`), unspecified (`::`), unique local (fc00::/7),
 *    link-local (fe80::/10), and IPv4-mapped IPv6 (`::ffff:127.0.0.1`,
 *    `::ffff:7f00:1`) — the embedded IPv4 is re-checked.
 *  - `*.local` mDNS / Bonjour hostnames.
 *  - URLs containing userinfo (`https://user:pass@host/…`) — the password
 *    leaks to the receiver on every delivery and indicates a confused or
 *    malicious caller.
 *
 * The `allowInsecure` flag relaxes the HTTP/HTTPS check AND the hostname
 * checks for local development testing. Production code paths derive
 * this from `BETTER_AUTH_URL` (see `isDevMode`).
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

  // Reject userinfo unconditionally. The browser strips it from cross-
  // origin fetches but we deliver from a server so the credentials would
  // leak on every delivery. Even legitimate Basic-auth receivers should
  // use the `Authorization` header at delivery time, not the URL.
  if (parsed.username !== "" || parsed.password !== "") {
    return { valid: false, error: "URL must not include userinfo (user:password@)" };
  }

  // In dev mode, skip hostname/IP restrictions to allow localhost testing.
  if (opts?.allowInsecure) {
    return { valid: true };
  }

  // `URL.hostname` returns IPv6 addresses with square brackets in some
  // runtimes (Workers, older Node) and without in others (modern browsers,
  // WHATWG spec). Strip them defensively so every downstream check sees
  // the bracket-free form.
  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: "URL must not point to a local or loopback address" };
  }

  // Reject *.local hostnames (mDNS / Bonjour).
  if (hostname.endsWith(".local")) {
    return { valid: false, error: "URL must not point to a .local address" };
  }

  // IPv6 check (URL.hostname strips the surrounding brackets, so a literal
  // `[::1]` arrives here as `::1`).
  if (hostname.includes(":")) {
    const ipv6Result = isBlockedIPv6(hostname);
    if (ipv6Result.blocked) {
      return { valid: false, error: ipv6Result.reason };
    }
    // A non-blocked IPv6 (e.g. a public IPv6) passes through; we don't
    // run the IPv4 patterns on it.
    return { valid: true };
  }

  // IPv4 — canonicalise non-standard encodings first.
  const canonical = canonicaliseIPv4(hostname);
  if (canonical) {
    const ipv4Result = ipv4PrivateCheck(canonical);
    if (ipv4Result.blocked) {
      return { valid: false, error: ipv4Result.reason };
    }
    // Canonicalised but public — fall through to "valid".
    return { valid: true };
  }

  // Treat as a DNS hostname. We deliberately do NOT resolve it here:
  //  - Resolving at validation time invites DNS rebinding (record flips
  //    to a private IP between validation and delivery).
  //  - The delivery client runs in Cloudflare Workers, which sits on a
  //    public-internet egress without access to internal AWS-style IMDS
  //    services, so the residual risk is smaller than in a VPC-hosted
  //    worker. If you migrate off Workers, add a resolve-and-recheck
  //    step at delivery time.
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Shared webhook handler helpers
// ---------------------------------------------------------------------------

/** Maximum number of webhooks allowed per workspace. */
export const MAX_WEBHOOKS_PER_WORKSPACE = 20;

/** Check if the worker is running in local dev mode. */
export function isDevMode(c: Context<AppEnv>): boolean {
  const authUrl = c.env.BETTER_AUTH_URL ?? "";
  return authUrl.includes("localhost") || authUrl.includes("127.0.0.1");
}

/**
 * Strip the `secret` field from a webhook row.
 *
 * Webhook secrets must only be exposed on creation or explicit regeneration
 * to avoid accidental leakage through list/detail endpoints.
 */
export function omitSecret<T extends Record<string, unknown> & { secret: string }>(
  row: T,
): Omit<T, "secret"> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "secret"),
  ) as Omit<T, "secret">;
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

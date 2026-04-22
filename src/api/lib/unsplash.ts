/**
 * Unsplash service module.
 *
 * Wraps calls to the Unsplash REST API (search, curated listing, and download
 * tracking) behind a typed interface. A factory `createUnsplashService` returns
 * `null` when the `UNSPLASH_ACCESS_KEY` binding is missing, allowing callers to
 * treat the feature as a soft-configured add-on and return 503 to clients when
 * disabled.
 *
 * Why this exists as a module:
 * - Normalises raw Unsplash payloads into our stored/wire shape
 *   (`UnsplashCoverPayload`) in a single place.
 * - Applies the required Unsplash attribution UTM parameters
 *   (`?utm_source=<app>&utm_medium=referral`) to all user-visible outbound
 *   links so we comply with Unsplash API guidelines.
 * - Centralises the 8-second request timeout and `Authorization: Client-ID`
 *   header, so handlers do not need to repeat low-level fetch plumbing.
 * - `trackDownload` MUST be safe to call via `c.executionCtx.waitUntil(...)` —
 *   Cloudflare Workers crashes the enclosing request if a promise passed to
 *   `waitUntil` rejects, so this method swallows all errors.
 */

import {
  UNSPLASH_DEFAULT_APP_NAME,
  UNSPLASH_UTM_MEDIUM,
  type UnsplashCoverPayload,
  type UnsplashCuratedInput,
  type UnsplashSearchInput,
  type UnsplashSearchResponse,
} from "../../shared/schemas/unsplash";
import type { AppBindings } from "../env";

const UNSPLASH_API_BASE = "https://api.unsplash.com";
const REQUEST_TIMEOUT_MS = 8_000;
const CURATED_DEFAULT_TOTAL_PAGES = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset of the raw Unsplash photo shape we depend on. We only type the fields
 * we consume so we do not have to maintain a full mirror of their schema.
 */
export type RawUnsplashPhoto = {
  id: string;
  width: number;
  height: number;
  color: string | null;
  blur_hash: string | null;
  description: string | null;
  alt_description?: string | null;
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  links: {
    self: string;
    html: string;
    download: string;
    download_location: string;
  };
  user: {
    username: string;
    name: string;
    profile_image?: {
      small?: string;
      medium?: string;
      large?: string;
    };
  };
};

type RawUnsplashSearchResponse = {
  total: number;
  total_pages: number;
  results: RawUnsplashPhoto[];
};

export type UnsplashService = {
  searchPhotos(input: UnsplashSearchInput): Promise<UnsplashSearchResponse>;
  listCurated(input: UnsplashCuratedInput): Promise<UnsplashSearchResponse>;
  /**
   * Fires a GET against an Unsplash `download_location` URL, as required by
   * the API terms when a user "downloads" (applies) a photo. Best-effort —
   * never throws; errors are logged.
   */
  trackDownload(downloadLocation: string): Promise<void>;
};

/**
 * Error thrown when the Unsplash API returns a non-OK status. `status` carries
 * the upstream HTTP code so handlers can map it to an appropriate client
 * response (without leaking upstream bodies).
 */
export class UnsplashError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UnsplashError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// UTM helpers
// ---------------------------------------------------------------------------

/**
 * Appends Unsplash attribution UTM parameters to a URL. Uses the URL API so
 * we correctly handle the `?` vs `&` separator when the source URL already
 * carries query parameters.
 */
export function appendUtm(url: string, appName: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", appName);
    u.searchParams.set("utm_medium", UNSPLASH_UTM_MEDIUM);
    return u.toString();
  } catch {
    // Fall back to a manual append if the string is not a parseable absolute
    // URL. In practice all Unsplash URLs are well-formed; this just guards
    // against malformed upstream payloads.
    const separator = url.includes("?") ? "&" : "?";
    const utm = `utm_source=${encodeURIComponent(appName)}&utm_medium=${encodeURIComponent(
      UNSPLASH_UTM_MEDIUM,
    )}`;
    return `${url}${separator}${utm}`;
  }
}

/**
 * Normalises a raw Unsplash photo into our stored/wire shape, applying UTM
 * params to every user-visible outbound URL (profileUrl, photoUrl).
 */
export function toCoverPayload(
  photo: RawUnsplashPhoto,
  appName: string,
): UnsplashCoverPayload {
  const profileBase = `https://unsplash.com/@${photo.user.username}`;
  return {
    id: photo.id,
    rawUrl: photo.urls.raw,
    url: photo.urls.regular,
    thumbUrl: photo.urls.thumb,
    blurHash: photo.blur_hash ?? null,
    color: photo.color ?? null,
    description: photo.description ?? photo.alt_description ?? null,
    width: photo.width,
    height: photo.height,
    photoUrl: appendUtm(photo.links.html, appName),
    downloadLocation: photo.links.download_location,
    user: {
      name: photo.user.name,
      username: photo.user.username,
      profileUrl: appendUtm(profileBase, appName),
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

async function unsplashFetch(
  url: string,
  accessKey: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        "Accept-Version": "v1",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildSearchUrl(input: UnsplashSearchInput): string {
  const params = new URLSearchParams();
  params.set("query", input.query);
  params.set("page", String(input.page));
  params.set("per_page", String(input.perPage));
  if (input.orientation) {
    params.set("orientation", input.orientation);
  }
  return `${UNSPLASH_API_BASE}/search/photos?${params.toString()}`;
}

function buildCuratedUrl(input: UnsplashCuratedInput): string {
  const params = new URLSearchParams();
  params.set("page", String(input.page));
  params.set("per_page", String(input.perPage));
  params.set("order_by", "latest");
  return `${UNSPLASH_API_BASE}/photos?${params.toString()}`;
}

async function readError(res: Response, context: string): Promise<never> {
  // We intentionally read (and discard after logging) the body so the upstream
  // reason is available in server logs but never returned verbatim to clients.
  let body = "";
  try {
    body = await res.text();
  } catch {
    // ignore
  }
  console.error(
    `[Unsplash] ${context} failed: status=${res.status}${
      body ? ` body=${body.slice(0, 500)}` : ""
    }`,
  );
  throw new UnsplashError(`Unsplash request failed (${context})`, res.status);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUnsplashService(
  env: AppBindings,
): UnsplashService | null {
  const accessKey = env.UNSPLASH_ACCESS_KEY;
  if (!accessKey || accessKey.trim() === "") {
    return null;
  }
  const appName = env.UNSPLASH_APP_NAME?.trim() || UNSPLASH_DEFAULT_APP_NAME;

  return {
    async searchPhotos(input) {
      const url = buildSearchUrl(input);
      const res = await unsplashFetch(url, accessKey);
      if (!res.ok) {
        await readError(res, "searchPhotos");
      }
      const raw: RawUnsplashSearchResponse = await res.json();
      return {
        page: input.page,
        perPage: input.perPage,
        total: raw.total ?? 0,
        totalPages: raw.total_pages ?? 0,
        results: (raw.results ?? []).map((p) => toCoverPayload(p, appName)),
      };
    },

    async listCurated(input) {
      const url = buildCuratedUrl(input);
      const res = await unsplashFetch(url, accessKey);
      if (!res.ok) {
        await readError(res, "listCurated");
      }
      const raw: RawUnsplashPhoto[] = await res.json();
      const results = raw.map((p) => toCoverPayload(p, appName));
      // The /photos endpoint doesn't report totals; use a bounded default so
      // the response shape stays uniform with /search/photos.
      const totalPages = CURATED_DEFAULT_TOTAL_PAGES;
      return {
        page: input.page,
        perPage: input.perPage,
        total: totalPages * input.perPage,
        totalPages,
        results,
      };
    },

    async trackDownload(downloadLocation) {
      // CRITICAL: this is called via `c.executionCtx.waitUntil(...)` from the
      // apply-cover handler. If this throws, it crashes the enclosing request
      // on Cloudflare Workers. Swallow every error and only log.
      try {
        const res = await unsplashFetch(downloadLocation, accessKey);
        if (!res.ok) {
          console.error(
            `[Unsplash] trackDownload non-OK: status=${res.status} url=${downloadLocation}`,
          );
        }
      } catch (err) {
        console.error("[Unsplash] trackDownload error:", err);
      }
    },
  };
}

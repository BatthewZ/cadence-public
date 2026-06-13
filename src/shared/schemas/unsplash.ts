import { z } from "zod";

export const UNSPLASH_DEFAULT_APP_NAME = "cadence";
export const UNSPLASH_UTM_MEDIUM = "referral";

export const unsplashSearchSchema = z.object({
  query: z.string().trim().min(1).max(100),
  page: z.coerce.number().int().min(1).max(50).default(1),
  perPage: z.coerce.number().int().min(1).max(30).default(24),
  orientation: z.enum(["landscape", "portrait", "squarish"]).optional(),
});

export const unsplashCuratedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(50).default(1),
  perPage: z.coerce.number().int().min(1).max(30).default(24),
});

export const unsplashCoverPayloadSchema = z.object({
  id: z.string().min(1).max(64),
  /**
   * The imgix-backed raw URL (photo.urls.raw). Callers append their own
   * query params (w, q, auto, fm, etc.) via `buildUnsplashDisplayUrl` to
   * get context-appropriate renditions instead of always hotlinking the
   * 1080px `regular` rendition.
   */
  rawUrl: z.url(),
  /** photo.urls.regular — 1080px preset kept as a fallback for rows written
   *  before `rawUrl` was introduced and for consumers that cannot compose
   *  imgix URLs (e.g. plain <a> previews). */
  url: z.url(),
  /** photo.urls.thumb — 200px preset; kept for backward compatibility. */
  thumbUrl: z.url(),
  blurHash: z.string().max(64).nullable(),
  color: z.string().max(16).nullable(),
  description: z.string().max(500).nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  photoUrl: z.url(),
  downloadLocation: z.url(),
  user: z.object({
    name: z.string().max(200),
    username: z.string().max(100),
    profileUrl: z.url(),
  }),
});

/**
 * Persistence / read variant of {@link unsplashCoverPayloadSchema}.
 *
 * Identical to the strict schema EXCEPT `rawUrl` is OPTIONAL, because rows
 * written before `rawUrl` was introduced (see the `rawUrl` field doc above)
 * never stored it. This is the honest shape of every place that reads or
 * round-trips a STORED cover rather than accepting a freshly-picked one:
 *  - the `cover_unsplash` DB column (`$type`),
 *  - project/task API responses, and
 *  - workspace export → import round-trips.
 *
 * Why this is a SEPARATE schema and not just `rawUrl.optional()` on the one
 * above: the strict schema is the *write* contract. The `PUT .../cover/unsplash`
 * apply endpoints validate their request body with it, so every NEW cover is
 * guaranteed full-fidelity (carries `rawUrl`). Keeping the two distinct
 * preserves that creation guarantee while letting legacy rows round-trip
 * instead of failing import with
 * `coverUnsplash.rawUrl: expected string, received undefined`.
 *
 * The runtime read path already treats `rawUrl` as optional and falls back to
 * `url`/`thumbUrl` for these rows (see `buildUnsplashDisplayUrl`), so this
 * merely makes the type system agree with behavior that already shipped.
 */
export const storedUnsplashCoverPayloadSchema = unsplashCoverPayloadSchema.extend({
  rawUrl: z.url().optional(),
});

export const unsplashSearchResponseSchema = z.object({
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  results: z.array(unsplashCoverPayloadSchema),
});

export type UnsplashSearchInput = z.infer<typeof unsplashSearchSchema>;
export type UnsplashCuratedInput = z.infer<typeof unsplashCuratedQuerySchema>;
export type UnsplashCoverPayload = z.infer<typeof unsplashCoverPayloadSchema>;
export type StoredUnsplashCoverPayload = z.infer<typeof storedUnsplashCoverPayloadSchema>;
export type UnsplashSearchResponse = z.infer<typeof unsplashSearchResponseSchema>;

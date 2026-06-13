/**
 * Build a context-appropriate Unsplash display URL from a stored
 * `UnsplashCoverPayload`.
 *
 * Unsplash serves images through imgix, which honors query parameters like
 * `w`, `q`, `auto`, and `fit`. Rather than hotlinking the fixed 1080px
 * `regular` rendition everywhere — which is noticeably soft on retina covers
 * and wastefully large for thumbnails — we compose a URL from `rawUrl` with
 * the size and quality we actually need at each surface.
 *
 * Presets:
 *  - `cover` — 1600px-wide, q=80, auto-format. Targets cover-banner display
 *    on desktop retina and most common layouts.
 *  - `card`  — 500px-wide, q=75, auto-format. Targets picker grid cards at
 *    ~250–350 CSS px on 2x displays.
 *
 * Behavior:
 *  - When `rawUrl` is present (new rows), appends imgix params to it.
 *  - When `rawUrl` is absent (legacy rows written before this helper), falls
 *    back to the preset-specific pre-baked URL: `url` for `cover`,
 *    `thumbUrl` for `card`. Those rows will never look as crisp, but the
 *    feature still works.
 *
 * This logic must stay in `src/shared/` because both frontend display code
 * (CoverImage, CoverImagePicker) and future backend tests depend on it.
 */

import type { StoredUnsplashCoverPayload } from "../schemas/unsplash";

export type UnsplashDisplayPreset = "cover" | "card";

type PresetParams = Readonly<Record<string, string>>;

const PRESET_PARAMS: Record<UnsplashDisplayPreset, PresetParams> = {
  cover: { w: "1600", q: "80", auto: "format", fit: "max" },
  card: { w: "500", q: "75", auto: "format", fit: "max" },
};

/**
 * Widths emitted by `buildUnsplashDisplaySrcSet` for the cover preset:
 * - 800  → mobile landscape / narrow viewports (covers ~375-400 CSS px × 2x DPR)
 * - 1600 → mainstream laptop covers (~800 CSS px × 2x DPR)
 * - 2400 → wide / 4K retina monitors (~1200 CSS px × 2x DPR)
 * The browser picks the smallest width that satisfies the display, so mobile
 * doesn't pay the bandwidth for a 2400px asset.
 */
const COVER_SRCSET_WIDTHS = [800, 1600, 2400] as const;

/**
 * `rawUrl` is schema-required for *new* payloads (the apply endpoint
 * validates it), but may be `undefined` at runtime when reading a row
 * written before this field existed. Derived from
 * `StoredUnsplashCoverPayload` — the lenient persistence/read schema where
 * `rawUrl` is optional for exactly that reason — so the fallback branch
 * below stays honest by construction rather than via a hand-written type.
 */
type SourceWithFallback = Pick<
  StoredUnsplashCoverPayload,
  "url" | "thumbUrl" | "rawUrl"
>;

/**
 * Compose a display URL from an Unsplash payload and a preset.
 *
 * Gracefully falls back to pre-baked URLs when `rawUrl` is missing
 * (defensive for legacy rows whose payload predates `rawUrl`).
 */
export function buildUnsplashDisplayUrl(
  payload: SourceWithFallback,
  preset: UnsplashDisplayPreset,
): string {
  const raw = payload.rawUrl;
  if (!raw) {
    return preset === "cover" ? payload.url : payload.thumbUrl;
  }

  const params = PRESET_PARAMS[preset];
  try {
    const u = new URL(raw);
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    // rawUrl was not a parseable absolute URL — unlikely, but fall back so
    // we never render a broken `<img>` over an otherwise-valid cover.
    return preset === "cover" ? payload.url : payload.thumbUrl;
  }
}

/**
 * Build an `<img srcSet>` string for the cover preset. Returns multiple
 * width-keyed URLs composed from `rawUrl` so the browser can pick the
 * smallest that satisfies the display. Paired with `sizes="100vw"` at the
 * usage site.
 *
 * Returns `null` when:
 *  - `rawUrl` is absent (legacy row) — the caller falls back to plain `src`.
 *  - `rawUrl` is not a parseable URL.
 *
 * There's no card equivalent because picker thumbnails render at a fixed
 * ~250–350 CSS px; a single `w=500` rendition is plenty there.
 */
export function buildUnsplashDisplaySrcSet(
  payload: SourceWithFallback,
): string | null {
  const raw = payload.rawUrl;
  if (!raw) return null;
  try {
    // Validate upfront so we can return null on malformed rawUrl without
    // emitting a srcset whose entries fall back to `url`/`thumbUrl` — those
    // wouldn't vary by width and would mislead the browser's picker.
    new URL(raw);
  } catch {
    return null;
  }

  // Compose each width by reusing `buildUnsplashDisplayUrl` with the cover
  // preset, then overriding `w` per descriptor. `URLSearchParams.set`
  // replaces the preset's default `w`, so we automatically inherit any new
  // imgix params added to PRESET_PARAMS.cover without touching this fn.
  const base = buildUnsplashDisplayUrl(payload, "cover");
  return COVER_SRCSET_WIDTHS.map((w) => {
    const u = new URL(base);
    u.searchParams.set("w", String(w));
    return `${u.toString()} ${w}w`;
  }).join(", ");
}

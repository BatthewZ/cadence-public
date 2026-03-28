/**
 * Shared theme definitions used by both server-side validation and frontend rendering.
 * This is the single source of truth for available themes — keep this list in sync
 * with the FOUC prevention script in `src/web/index.html`.
 */
export const THEMES = ["default", "noir", "botanical", "sunset", "candy", "cyberpunk", "pastel", "brutalist", "chalk", "ocean", "ember", "luxe", "deco", "sakura"] as const;
export type Theme = (typeof THEMES)[number];

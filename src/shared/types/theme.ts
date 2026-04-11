/**
 * Shared theme definitions used by both server-side validation and frontend rendering.
 * This is the single source of truth for available themes — keep this list in sync
 * with the FOUC prevention script in `src/web/index.html`.
 */
export const THEMES = ["default", "noir", "botanical", "sunset", "candy", "cyberpunk", "pastel", "brutalist", "ocean", "ember", "luxe", "sakura", "melancholy", "storm", "dreamlike", "terminal", "synthwave", "forest", "slate", "paper", "carbon"] as const;
export type Theme = (typeof THEMES)[number];

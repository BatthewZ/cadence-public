# Theming

The entire design system is re-themeable by overriding `:root` variables. No component code changes are needed.

### How it works

1. Theme files live in `src/web/style/themes/` (e.g. `events.css`, `grimdark.css`, `tech.css`).
2. Each theme scopes overrides to a data attribute selector: `:root[data-theme="theme-name"]`.
3. To activate a theme, set `data-theme` on the root `<html>` element and import the theme CSS file after the token imports.
4. Themes can override any combination of `--C-*`, `--MOTION-*`, `--OVERLAY-*`, `--MEDIA-*`, `--RADIUS-*`, `--SHADOW-*`, `--DURATION-*`, and font variables.
5. Each theme declares `color-scheme: light` or `color-scheme: dark` so native browser UI (scrollbars, form controls, selection highlights) matches the theme's palette.

### FOUC prevention

The saved theme is restored before the first paint via a blocking inline `<script>` in the `<head>` of `src/web/index.html`. This script reads `localStorage('theme')` and sets `data-theme` on `<html>` synchronously — before any CSS or module scripts load. This prevents a Flash of Unstyled Content (FOUC) when a non-default theme is active.

> **Keep in sync:** The inline script hardcodes the list of valid theme names. When adding or removing a theme, update the array in the inline script to match the `THEMES` constant in `src/web/hooks/use-theme.ts`.

### Self-hosted fonts

All theme fonts are self-hosted as woff2 files in `src/web/fonts/`, with `@font-face` declarations in `src/web/style/fonts.css`. This eliminates external requests to Google Fonts and improves first-paint performance. To regenerate fonts after adding a new theme, run `bun run scripts/download-fonts.ts`.

### Token categories by "feel"

| Category      | Variables                                  | What it controls            |
| ------------- | ------------------------------------------ | --------------------------- |
| **Look**      | `--C-*` (colors), `--SHADOW-*`, `--RADIUS-*` | Brand identity              |
| **Feel**      | `--MOTION-*` (durations, easing, distances, scale) | Personality and weight |
| **Atmosphere**| `--OVERLAY-*` (scrims, blurs, gradients)   | Mood and depth              |

### Creating a new theme

1. Create a new CSS file in `src/web/style/themes/` (e.g. `my-theme.css`).
2. Define all overrides under `:root[data-theme="my-theme"]`, starting with `color-scheme`:

```css
:root[data-theme="my-theme"] {
  /* Color scheme — tells the browser whether this is a light or dark theme.
     Controls native UI: scrollbars, form controls, selection highlights. */
  color-scheme: light; /* or "dark" for dark-themed themes */

  /* Fonts */
  --DEFAULT-FONT: "Your Body Font", sans-serif;
  --HEADING-FONT: "Your Heading Font", serif;
  --HEADING-LETTER-SPACING: -0.01em;
  --HEADING-TEXT-TRANSFORM: none;

  /* Brand colors (use OKLCH for perceptually uniform color manipulation) */
  --C-PRIMARY: oklch(L C H);
  --C-PRIMARY-HOVER: oklch(L C H);
  --C-PRIMARY-ACTIVE: oklch(L C H);
  --C-SECONDARY: oklch(L C H);
  --C-SECONDARY-HOVER: oklch(L C H);
  --C-ACCENT: oklch(L C H);
  --C-ACCENT-HOVER: oklch(L C H);

  /* Surface colors */
  --C-SURFACE-0: oklch(L C H);
  --C-SURFACE-1: oklch(L C H);
  --C-SURFACE-2: oklch(L C H);
  --C-SURFACE-3: oklch(L C H);

  /* Text colors */
  --C-TEXT-PRIMARY: oklch(L C H);
  --C-TEXT-SECONDARY: oklch(L C H);
  --C-TEXT-MUTED: oklch(L C H);
  --C-TEXT-INVERSE: oklch(L C H);
  --C-TEXT-ON-PRIMARY: oklch(L C H);
  --C-TEXT-ON-ACCENT: oklch(L C H);

  /* Border colors */
  --C-BORDER-DEFAULT: oklch(L C H);
  --C-BORDER-STRONG: oklch(L C H);
  --C-BORDER-FOCUS: oklch(L C H);

  /* Radius */
  --RADIUS-SM: ...;
  --RADIUS-MD: ...;
  --RADIUS-LG: ...;
  --RADIUS-XL: ...;

  /* Shadows */
  --SHADOW-SM: ...;
  --SHADOW-MD: ...;
  --SHADOW-LG: ...;

  /* Motion */
  --MOTION-DURATION-ENTER: ...;
  --MOTION-EASE-ENTER: ...;
  /* ... */

  /* Overlay */
  --OVERLAY-SCRIM-COLOR: ...;
  --OVERLAY-GRADIENT-START: ...;
  --OVERLAY-GRADIENT-END: ...;
}
```

3. Import the theme file in your app CSS (after token imports).
4. Add the theme name to the `THEMES` array in `src/web/hooks/use-theme.ts` **and** to the inline script in `src/web/index.html`.
5. Set `data-theme="my-theme"` on the `<html>` element.

---

## Built-in Themes

### Default (no theme attribute)

The base light theme (`color-scheme: light`). Clean, neutral slate/gray palette. Standard border radii and shadows. Moderate animation timing. Suitable for general-purpose applications.

### Events (`data-theme="events"`)

**File:** `src/web/style/themes/events.css`

Warm, editorial, celebratory. Think event ticketing, lifestyle magazines, cultural platforms.

| Aspect | Details |
| ------ | ------- |
| **Fonts** | Playfair Display (headings), Nunito (body), Fira Code (mono) |
| **Colors** | Purple primary (`#7c3aed`), orange accent (`#f97316`), golden secondary (`#fde68a`), warm cream surfaces |
| **Radius** | Large and rounded (SM: 8px, MD: 14px, LG: 20px, XL: 28px) |
| **Shadows** | Warm-toned with purple/orange tint |
| **Motion** | Bouncy, energetic (350ms enter with overshoot easing, 60ms stagger) |
| **Typography** | Bold weight 800, generous line-heights, editorial feel |

### Grimdark (`data-theme="grimdark"`)

**File:** `src/web/style/themes/grimdark.css`

Gothic, oppressive, heavy (`color-scheme: dark`). Think dark fantasy, tabletop gaming, mature content.

| Aspect | Details |
| ------ | ------- |
| **Fonts** | Cinzel (headings), Source Serif 4 (body), IBM Plex Mono (mono) |
| **Colors** | Near-black primary (`#1a1a1a`), blood-red accent (`#b91c1c`), charcoal surfaces, parchment text (`#d4c5a9`) |
| **Radius** | Sharp, brutal -- no rounding (SM: 0px, MD: 0px, LG: 2px, XL: 2px) |
| **Shadows** | Deep voids, inky black with high opacity |
| **Motion** | Slow, weighty, deliberate (500ms enter, 600ms shift, 80ms stagger) |
| **Typography** | Bold weight 900, uppercase headings with wide letter-spacing (`0.06em`) |
| **Headings** | `text-transform: uppercase` via `--HEADING-TEXT-TRANSFORM` |

### Tech (`data-theme="tech"`)

**File:** `src/web/style/themes/tech.css`

Terminal, precise, futuristic (`color-scheme: dark`). Think developer tools, SaaS dashboards, cyberpunk interfaces.

| Aspect | Details |
| ------ | ------- |
| **Fonts** | Space Grotesk (headings), Inter (body), JetBrains Mono (mono) |
| **Colors** | Near-black primary (`#09090b`), neon green accent (`#00ff88`), deep black surfaces with blue undertone, high-contrast text |
| **Radius** | Tight, geometric (SM: 2px, MD: 4px, LG: 6px, XL: 8px) |
| **Shadows** | Neon glow effect using accent color with low opacity |
| **Motion** | Fast, snappy, precise (180ms enter, 250ms shift, 30ms stagger) |
| **Typography** | Clean, tight (Body-1: 15px, Body-3: 11px), tight letter-spacing on headings (`-0.03em`) |

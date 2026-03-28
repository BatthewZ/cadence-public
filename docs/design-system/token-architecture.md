# Token Architecture

```
:root CSS variables          -->  @theme inline mappings  -->  Tailwind utility classes
(e.g. --C-PRIMARY: #1e293b)      (--color-primary: var(...))   (bg-primary, text-primary)
```

### How it works

1. **Raw tokens** are defined as `--UPPER_CASE` CSS custom properties on `:root` in files under `src/web/style/tokens/`.
2. **Tailwind mappings** inside `@theme inline { }` blocks in the same files bridge CSS variables into Tailwind's theme system.
3. **Components** use standard Tailwind utility classes (`bg-primary`, `text-h1`, `gap-r3`) that reference these tokens.
4. **Theming** works by overriding `:root` variables in theme files under `src/web/style/themes/`. No component code changes needed.

### File structure

```
src/web/style/
  tokens/
    index.css          -- Imports all token files
    colors.css         -- Brand, surface, text, border, status colors
    radius.css         -- Border radius tokens
    shadows.css        -- Elevation/shadow tokens
    transitions.css    -- Interaction transition durations
    motion.css         -- Animation durations, easing, distances, parallax
    overlay.css        -- Scrims, gradients, blurs
    media.css          -- Aspect ratios, hover effects, carousel
  responsive/
    spacing.css        -- Responsive spacing tokens (r1-r6)
    text.css           -- Responsive typography tokens (h1-h6, body-1-3)
  themes/
    events.css         -- Warm, editorial, celebratory theme
    grimdark.css       -- Gothic, oppressive, heavy theme
    tech.css           -- Terminal, precise, futuristic theme
```

The `tokens/index.css` barrel file imports all token files:

```css
@import "./colors.css";
@import "./radius.css";
@import "./shadows.css";
@import "./transitions.css";
@import "./motion.css";
@import "./overlay.css";
@import "./media.css";
```

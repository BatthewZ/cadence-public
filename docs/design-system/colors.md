# Color Tokens

**File:** `src/web/style/tokens/colors.css`

All colors are defined as [OKLCH](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch) values on `:root`, then mapped to Tailwind via `@theme inline`. OKLCH provides perceptually uniform lightness and a wider gamut than sRGB hex, making color manipulation (tinting, mixing) more predictable across themes.

> **Note on text colors:** The Tailwind mappings use a `fg-` prefix (e.g. `--color-fg-primary`) instead of `text-` to avoid conflicts with Tailwind's `text-*` font-size utilities. Use classes like `text-fg-primary`, `text-fg-secondary`, etc.

### Brand

| CSS Variable            | Default Value                      | Tailwind Class       | Purpose                        |
| ----------------------- | ---------------------------------- | -------------------- | ------------------------------ |
| `--C-PRIMARY`           | `oklch(0.2795 0.0368 260.03)`     | `bg-primary`         | Primary actions, active states |
| `--C-PRIMARY-HOVER`     | `oklch(0.2077 0.0398 265.75)`     | `bg-primary-hover`   | Primary hover                  |
| `--C-PRIMARY-ACTIVE`    | `oklch(0.3717 0.0392 257.29)`     | `bg-primary-active`  | Primary pressed                |
| `--C-SECONDARY`         | `oklch(0.9288 0.0126 255.51)`     | `bg-secondary`       | Secondary actions              |
| `--C-SECONDARY-HOVER`   | `oklch(0.869 0.0198 252.89)`      | `bg-secondary-hover` | Secondary hover                |
| `--C-ACCENT`            | `oklch(0.5461 0.2152 262.88)`     | `bg-accent`          | Links, highlights              |
| `--C-ACCENT-HOVER`      | `oklch(0.4882 0.2172 264.38)`     | `bg-accent-hover`    | Accent hover                   |

### Surface

| CSS Variable      | Default Value                      | Tailwind Class  | Purpose                        |
| ----------------- | ---------------------------------- | --------------- | ------------------------------ |
| `--C-SURFACE-0`   | `oklch(1 0 0)`                     | `bg-surface-0`  | Cards, modals, inputs          |
| `--C-SURFACE-1`   | `oklch(0.9846 0.0017 247.84)`     | `bg-surface-1`  | Page background                |
| `--C-SURFACE-2`   | `oklch(0.967 0.0029 264.54)`      | `bg-surface-2`  | Inset/recessed areas, hover bg |
| `--C-SURFACE-3`   | `oklch(0.9276 0.0058 264.53)`     | `bg-surface-3`  | Disabled backgrounds           |

### Text

| CSS Variable            | Default Value                      | Tailwind Class       | Purpose                          |
| ----------------------- | ---------------------------------- | -------------------- | -------------------------------- |
| `--C-TEXT-PRIMARY`      | `oklch(0.2101 0.0318 264.66)`     | `text-fg-primary`    | Headings, primary content        |
| `--C-TEXT-SECONDARY`    | `oklch(0.4461 0.0263 256.8)`      | `text-fg-secondary`  | Body text, descriptions          |
| `--C-TEXT-MUTED`        | `oklch(0.7137 0.0192 261.32)`     | `text-fg-muted`      | Placeholders, hints              |
| `--C-TEXT-INVERSE`      | `oklch(1 0 0)`                     | `text-fg-inverse`    | Text on dark/primary backgrounds |
| `--C-TEXT-ON-PRIMARY`   | `oklch(1 0 0)`                     | `text-fg-on-primary` | Text on primary-colored surfaces |
| `--C-TEXT-ON-ACCENT`    | `oklch(1 0 0)`                     | `text-fg-on-accent`  | Text on accent-colored surfaces  |

### Border

| CSS Variable          | Default Value                      | Tailwind Class          | Purpose                           |
| --------------------- | ---------------------------------- | ----------------------- | --------------------------------- |
| `--C-BORDER-DEFAULT`  | `oklch(0.9276 0.0058 264.53)`     | `border-border-default` | Default borders                   |
| `--C-BORDER-STRONG`   | `oklch(0.8717 0.0093 258.34)`     | `border-border-strong`  | Emphasized borders, input borders |
| `--C-BORDER-FOCUS`    | `oklch(0.6231 0.188 259.81)`      | `border-border-focus`   | Focus ring color                  |

### Status

| CSS Variable              | Default Value                      | Tailwind Class           | Purpose            |
| ------------------------- | ---------------------------------- | ------------------------ | ------------------ |
| `--C-STATUS-ERROR`        | `oklch(0.5771 0.2152 27.33)`      | `text-status-error`      | Error text/icons   |
| `--C-STATUS-ERROR-BG`     | `oklch(0.9705 0.0129 17.38)`      | `bg-status-error-bg`     | Error background   |
| `--C-STATUS-SUCCESS`      | `oklch(0.6271 0.1699 149.21)`     | `text-status-success`    | Success text/icons |
| `--C-STATUS-SUCCESS-BG`   | `oklch(0.9819 0.0181 155.83)`     | `bg-status-success-bg`   | Success background |
| `--C-STATUS-WARNING`      | `oklch(0.6658 0.1574 58.32)`      | `text-status-warning`    | Warning text/icons |
| `--C-STATUS-WARNING-BG`   | `oklch(0.9869 0.0214 95.28)`      | `bg-status-warning-bg`   | Warning background |
| `--C-STATUS-INFO`         | `oklch(0.5461 0.2152 262.88)`     | `text-status-info`       | Info text/icons    |
| `--C-STATUS-INFO-BG`      | `oklch(0.9705 0.0142 254.6)`      | `bg-status-info-bg`      | Info background    |

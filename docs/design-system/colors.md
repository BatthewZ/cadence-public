# Color Tokens

**File:** `src/web/style/tokens/colors.css`

All colors are defined as hex values on `:root`, then mapped to Tailwind via `@theme inline`.

> **Note on text colors:** The Tailwind mappings use a `fg-` prefix (e.g. `--color-fg-primary`) instead of `text-` to avoid conflicts with Tailwind's `text-*` font-size utilities. Use classes like `text-fg-primary`, `text-fg-secondary`, etc.

### Brand

| CSS Variable            | Default Value     | Tailwind Class       | Purpose                        |
| ----------------------- | ----------------- | -------------------- | ------------------------------ |
| `--C-PRIMARY`           | `#1e293b`         | `bg-primary`         | Primary actions, active states |
| `--C-PRIMARY-HOVER`     | `#0f172a`         | `bg-primary-hover`   | Primary hover                  |
| `--C-PRIMARY-ACTIVE`    | `#334155`         | `bg-primary-active`  | Primary pressed                |
| `--C-SECONDARY`         | `#e2e8f0`         | `bg-secondary`       | Secondary actions              |
| `--C-SECONDARY-HOVER`   | `#cbd5e1`         | `bg-secondary-hover` | Secondary hover                |
| `--C-ACCENT`            | `#2563eb`         | `bg-accent`          | Links, highlights              |
| `--C-ACCENT-HOVER`      | `#1d4ed8`         | `bg-accent-hover`    | Accent hover                   |

### Surface

| CSS Variable      | Default Value | Tailwind Class  | Purpose                        |
| ----------------- | ------------- | --------------- | ------------------------------ |
| `--C-SURFACE-0`   | `#ffffff`     | `bg-surface-0`  | Cards, modals, inputs          |
| `--C-SURFACE-1`   | `#f9fafb`     | `bg-surface-1`  | Page background                |
| `--C-SURFACE-2`   | `#f3f4f6`     | `bg-surface-2`  | Inset/recessed areas, hover bg |
| `--C-SURFACE-3`   | `#e5e7eb`     | `bg-surface-3`  | Disabled backgrounds           |

### Text

| CSS Variable            | Default Value | Tailwind Class       | Purpose                          |
| ----------------------- | ------------- | -------------------- | -------------------------------- |
| `--C-TEXT-PRIMARY`      | `#111827`     | `text-fg-primary`    | Headings, primary content        |
| `--C-TEXT-SECONDARY`    | `#4b5563`     | `text-fg-secondary`  | Body text, descriptions          |
| `--C-TEXT-MUTED`        | `#9ca3af`     | `text-fg-muted`      | Placeholders, hints              |
| `--C-TEXT-INVERSE`      | `#ffffff`     | `text-fg-inverse`    | Text on dark/primary backgrounds |
| `--C-TEXT-ON-PRIMARY`   | `#ffffff`     | `text-fg-on-primary` | Text on primary-colored surfaces |
| `--C-TEXT-ON-ACCENT`    | `#ffffff`     | `text-fg-on-accent`  | Text on accent-colored surfaces  |

### Border

| CSS Variable          | Default Value | Tailwind Class          | Purpose                           |
| --------------------- | ------------- | ----------------------- | --------------------------------- |
| `--C-BORDER-DEFAULT`  | `#e5e7eb`     | `border-border-default` | Default borders                   |
| `--C-BORDER-STRONG`   | `#d1d5db`     | `border-border-strong`  | Emphasized borders, input borders |
| `--C-BORDER-FOCUS`    | `#3b82f6`     | `border-border-focus`   | Focus ring color                  |

### Status

| CSS Variable              | Default Value | Tailwind Class           | Purpose            |
| ------------------------- | ------------- | ------------------------ | ------------------ |
| `--C-STATUS-ERROR`        | `#dc2626`     | `text-status-error`      | Error text/icons   |
| `--C-STATUS-ERROR-BG`     | `#fef2f2`     | `bg-status-error-bg`     | Error background   |
| `--C-STATUS-SUCCESS`      | `#16a34a`     | `text-status-success`    | Success text/icons |
| `--C-STATUS-SUCCESS-BG`   | `#f0fdf4`     | `bg-status-success-bg`   | Success background |
| `--C-STATUS-WARNING`      | `#d97706`     | `text-status-warning`    | Warning text/icons |
| `--C-STATUS-WARNING-BG`   | `#fffbeb`     | `bg-status-warning-bg`   | Warning background |
| `--C-STATUS-INFO`         | `#2563eb`     | `text-status-info`       | Info text/icons    |
| `--C-STATUS-INFO-BG`      | `#eff6ff`     | `bg-status-info-bg`      | Info background    |

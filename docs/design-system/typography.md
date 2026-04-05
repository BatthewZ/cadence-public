# Typography

**File:** `src/web/style/responsive/text.css`

Font sizes and line heights scale automatically at the `640px` (`40rem`) breakpoint. All values use `rem` units (base 16px). Font weights are also responsive.

### Headings

| Token | CSS Variable | Mobile (size/line-height)     | Desktop (size/line-height)      | Tailwind Class | Weight |
| ----- | ------------ | ----------------------------- | ------------------------------- | -------------- | ------ |
| `h1`  | `--H1`       | 2.25rem / 2.75rem            | 4rem / 4.5rem                   | `text-h1`      | 700    |
| `h2`  | `--H2`       | 1.75rem / 2.25rem            | 3rem / 4rem                     | `text-h2`      | 700    |
| `h3`  | `--H3`       | 1.5rem / 2rem                | 2.25rem / 3.125rem             | `text-h3`      | 700    |
| `h4`  | `--H4`       | 1.25rem / 2rem               | 1.75rem / 2.625rem             | `text-h4`      | 700    |
| `h5`  | `--H5`       | 1.125rem / 1.75rem           | 1.25rem / 2rem                 | `text-h5`      | 700    |
| `h6`  | `--H6`       | 1rem / 1.5rem                | 1.25rem / 2rem                 | `text-h6`      | 600    |

### Body

| Token    | CSS Variable    | Mobile (size/line-height)     | Desktop (size/line-height)      | Tailwind Class |
| -------- | --------------- | ----------------------------- | ------------------------------- | -------------- |
| `body-1` | `--BodyText-1`  | 0.875rem / 1.875rem          | 1rem / 2rem                     | `text-body-1`  |
| `body-2` | `--BodyText-2`  | 0.8125rem / 1.5rem           | 0.875rem / 1.75rem             | `text-body-2`  |
| `body-3` | `--BodyText-3`  | 0.75rem / 1.75rem            | 0.8125rem / 1.75rem            | `text-body-3`  |

### Font Weights

Font weights are responsive too -- they step up at the `640px` (`40rem`) breakpoint:

| Token          | CSS Variable        | Mobile | Desktop |
| -------------- | ------------------- | ------ | ------- |
| `font-semibold` | `--Semibold-Weight` | 500    | 600     |
| `font-bold`    | `--Bold-Weight`     | 600    | 700     |

### Heading styles

All heading elements (`h1`-`h6`) and their class equivalents (`.h1`-`.h6`) receive additional styling from the base layer:

```css
h1, h2, h3, h4, h5, h6,
.h1, .h2, .h3, .h4, .h5, .h6 {
  font-family: var(--HEADING-FONT);
  letter-spacing: var(--HEADING-LETTER-SPACING);
  text-transform: var(--HEADING-TEXT-TRANSFORM);
}
```

These variables (`--HEADING-FONT`, `--HEADING-LETTER-SPACING`, `--HEADING-TEXT-TRANSFORM`) are overridden by themes to change heading personality.

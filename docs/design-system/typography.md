# Typography

**File:** `src/web/style/responsive/text.css`

Font sizes and line heights scale automatically at the `640px` breakpoint. Font weights are also responsive.

### Headings

| Token | CSS Variable | Mobile (size/line-height) | Desktop (size/line-height) | Tailwind Class | Weight |
| ----- | ------------ | ------------------------- | -------------------------- | -------------- | ------ |
| `h1`  | `--H1`       | 36px / 44px               | 64px / 72px                | `text-h1`      | 700    |
| `h2`  | `--H2`       | 28px / 36px               | 48px / 64px                | `text-h2`      | 700    |
| `h3`  | `--H3`       | 24px / 32px               | 36px / 50px                | `text-h3`      | 700    |
| `h4`  | `--H4`       | 20px / 32px               | 28px / 42px                | `text-h4`      | 700    |
| `h5`  | `--H5`       | 18px / 28px               | 20px / 32px                | `text-h5`      | 700    |
| `h6`  | `--H6`       | 16px / 24px               | 20px / 32px                | `text-h6`      | 600    |

### Body

| Token    | CSS Variable    | Mobile (size/line-height) | Desktop (size/line-height) | Tailwind Class |
| -------- | --------------- | ------------------------- | -------------------------- | -------------- |
| `body-1` | `--BodyText-1`  | 14px / 30px               | 16px / 32px                | `text-body-1`  |
| `body-2` | `--BodyText-2`  | 13px / 24px               | 14px / 28px                | `text-body-2`  |
| `body-3` | `--BodyText-3`  | 12px / 28px               | 13px / 28px                | `text-body-3`  |

### Font Weights

Font weights are responsive too -- they step up at the 640px breakpoint:

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

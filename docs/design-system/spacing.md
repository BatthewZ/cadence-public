# Responsive Spacing

**File:** `src/web/style/responsive/spacing.css`

Six spacing tokens that automatically scale at the `640px` (`40rem`) breakpoint. Use them anywhere Tailwind accepts spacing: `gap-r3`, `p-r2`, `m-r1`, `px-r4`, etc.

| Token | CSS Variable | Mobile  | Desktop (>=640px) | Tailwind Class            | Usage                                     |
| ----- | ------------ | ------- | ----------------- | ------------------------- | ----------------------------------------- |
| `r1`  | `--R-SIZE-1` | `36px`  | `96px`            | `gap-r1`, `p-r1`, `m-r1` | Hero/section spacing                      |
| `r2`  | `--R-SIZE-2` | `20px`  | `32px`            | `gap-r2`, `p-r2`, `m-r2` | Card padding, section gaps                |
| `r3`  | `--R-SIZE-3` | `16px`  | `24px`            | `gap-r3`, `p-r3`, `m-r3` | Component internal padding                |
| `r4`  | `--R-SIZE-4` | `12px`  | `20px`            | `gap-r4`, `p-r4`, `m-r4` | Element spacing                           |
| `r5`  | `--R-SIZE-5` | `8px`   | `12px`            | `gap-r5`, `p-r5`, `m-r5` | Tight spacing (input padding, small gaps) |
| `r6`  | `--R-SIZE-6` | `4px`   | `4px`             | `gap-r6`, `p-r6`, `m-r6` | Micro spacing (icon gaps, badge padding)  |

The responsive breakpoint is implemented with a CSS media query:

```css
:root {
  --R-SIZE-1: 36px;
  /* ... */
}

@media (width >= 40rem) {
  :root {
    --R-SIZE-1: 96px;
    /* ... */
  }
}
```

Tailwind mapping:

```css
@theme inline {
  --spacing-r1: var(--R-SIZE-1);
  --spacing-r2: var(--R-SIZE-2);
  /* ... */
}
```

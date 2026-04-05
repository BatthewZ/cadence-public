# Responsive Spacing

**File:** `src/web/style/responsive/spacing.css`

Six spacing tokens that automatically scale at the `640px` (`40rem`) breakpoint. Use them anywhere Tailwind accepts spacing: `gap-r3`, `p-r2`, `m-r1`, `px-r4`, etc.

| Token | CSS Variable | Mobile     | Desktop (>=640px) | Tailwind Class            | Usage                                     |
| ----- | ------------ | ---------- | ----------------- | ------------------------- | ----------------------------------------- |
| `r1`  | `--R-SIZE-1` | `2.25rem`  | `6rem`            | `gap-r1`, `p-r1`, `m-r1` | Hero/section spacing                      |
| `r2`  | `--R-SIZE-2` | `1.25rem`  | `2rem`            | `gap-r2`, `p-r2`, `m-r2` | Card padding, section gaps                |
| `r3`  | `--R-SIZE-3` | `1rem`     | `1.5rem`          | `gap-r3`, `p-r3`, `m-r3` | Component internal padding                |
| `r4`  | `--R-SIZE-4` | `0.75rem`  | `1.25rem`         | `gap-r4`, `p-r4`, `m-r4` | Element spacing                           |
| `r5`  | `--R-SIZE-5` | `0.5rem`   | `0.75rem`         | `gap-r5`, `p-r5`, `m-r5` | Tight spacing (input padding, small gaps) |
| `r6`  | `--R-SIZE-6` | `0.25rem`  | `0.25rem`         | `gap-r6`, `p-r6`, `m-r6` | Micro spacing (icon gaps, badge padding)  |

The responsive breakpoint is implemented with a CSS media query:

```css
:root {
  --R-SIZE-1: 2.25rem;
  /* ... */
}

@media (width >= 40rem) {
  :root {
    --R-SIZE-1: 6rem;
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

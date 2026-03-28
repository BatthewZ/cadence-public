# ProgressBar

Animated fill bar with accessible ARIA markup. Supports color variants, visual style variants, and size options. Built as a compound component.

**Source:** `src/web/components/ui/ProgressBar.tsx`
**Styles:** `src/web/style/components/progress-bar.css`

## Compound API

| Component          | Element  | Purpose                           |
| ------------------ | -------- | --------------------------------- |
| `ProgressBar`      | `<div>`  | Root track with fill bar.         |
| `ProgressBar.Label`| `<span>` | Descriptive label above the bar.  |
| `ProgressBar.Value`| `<span>` | Numeric value display above the bar. |

## Props

### ProgressBar (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | **required** | Current progress value. |
| `max` | `number` | `100` | Maximum value. The fill width is calculated as `(value / max) * 100%`. |
| `variant` | `"default" \| "gradient" \| "striped"` | `"default"` | Visual style of the fill bar. |
| `color` | `"accent" \| "success" \| "warning" \| "error"` | `"accent"` | Fill color. |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Track height: `sm` = `var(--R-SIZE-6)`, `md` = `var(--R-SIZE-5)`, `lg` = `var(--R-SIZE-4)`. |
| `animate` | `boolean` | `true` | Enables width transition animation. Disabled automatically when `prefers-reduced-motion: reduce`. |
| `className` | `string` | -- | Additional CSS classes on the track. |

### ProgressBar.Label

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | -- | Label text. |
| `className` | `string` | -- | Additional CSS classes. |

Styled with `--BodyText-2` font size, `--Semibold-Weight`, and `--C-TEXT-SECONDARY` color.

### ProgressBar.Value

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | -- | Value text (e.g., "75%"). |
| `className` | `string` | -- | Additional CSS classes. |

Styled with `--BodyText-2` font size, `--Bold-Weight`, `--C-TEXT-PRIMARY` color, and `tabular-nums`.

## Variants

### Default

Solid fill color using the selected `color` prop.

### Gradient

Linear gradient from `--C-ACCENT` to `--C-ACCENT-HOVER` (left to right).

### Striped

45-degree repeating stripe pattern overlaid on the fill color with semi-transparent white stripes.

## Colors

| Color | CSS Variable |
| --- | --- |
| `accent` | `--C-ACCENT` |
| `success` | `--C-STATUS-SUCCESS` |
| `warning` | `--C-STATUS-WARNING` |
| `error` | `--C-STATUS-ERROR` |

## Accessibility

- `role="progressbar"` on the root element.
- `aria-valuenow` set to the current `value`.
- `aria-valuemin` set to `0`.
- `aria-valuemax` set to the `max` prop.

## Animation

The fill width transition uses `--MOTION-DURATION-SHIFT` and `--MOTION-EASE-SHIFT` tokens. Transitions are disabled when `animate={false}` or `prefers-reduced-motion: reduce`.

## Usage

### Basic Progress Bar

```tsx
import { ProgressBar } from "@/web/components/ui/ProgressBar";

<ProgressBar value={65} />
```

### With Label and Value

```tsx
<div>
  <div className="flex justify-between mb-r6">
    <ProgressBar.Label>Storage Used</ProgressBar.Label>
    <ProgressBar.Value>65%</ProgressBar.Value>
  </div>
  <ProgressBar value={65} />
</div>
```

### Gradient Variant

```tsx
<ProgressBar value={80} variant="gradient" />
```

### Striped Variant

```tsx
<ProgressBar value={45} variant="striped" />
```

### Color Variants

```tsx
<div className="flex flex-col gap-r4">
  <ProgressBar value={90} color="success" />
  <ProgressBar value={60} color="warning" />
  <ProgressBar value={30} color="error" />
  <ProgressBar value={75} color="accent" />
</div>
```

### Size Variants

```tsx
<div className="flex flex-col gap-r4">
  <ProgressBar value={50} size="sm" />
  <ProgressBar value={50} size="md" />
  <ProgressBar value={50} size="lg" />
</div>
```

### Custom Max Value

```tsx
<ProgressBar value={3} max={10} color="success" />
```

### Without Animation

```tsx
<ProgressBar value={100} animate={false} color="success" />
```

### File Upload Progress

```tsx
function FileUpload({ progress }: { progress: number }) {
  return (
    <div>
      <div className="flex justify-between mb-r6">
        <ProgressBar.Label>Uploading...</ProgressBar.Label>
        <ProgressBar.Value>{Math.round(progress)}%</ProgressBar.Value>
      </div>
      <ProgressBar
        value={progress}
        variant="gradient"
        size="lg"
      />
    </div>
  );
}
```

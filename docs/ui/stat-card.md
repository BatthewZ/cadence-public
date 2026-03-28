# StatCard

Large number display with label, trend indicator, and optional animated count-up. Built as a compound component for flexible layout.

**Source:** `src/web/components/ui/StatCard.tsx`
**Styles:** `src/web/style/components/stat-card.css`

## Compound API

| Component        | Element  | Purpose                                          |
| ---------------- | -------- | ------------------------------------------------ |
| `StatCard`       | `<div>`  | Root container with surface background and border.|
| `StatCard.Value` | `<span>` | Large numeric display with optional count-up animation. |
| `StatCard.Label` | `<span>` | Descriptive label below the value.               |
| `StatCard.Trend` | `<span>` | Trend indicator with direction arrow and percentage. |
| `StatCard.Icon`  | `<div>`  | Optional icon slot with accent-colored background. |

## Props

### StatCard (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes. |

### StatCard.Value

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `animateValue` | `boolean` | `false` | Enables count-up animation on scroll-into-view. |
| `from` | `number` | `0` | Starting number for count-up animation. |
| `to` | `number` | -- | Target number for count-up animation. Required when `animateValue` is `true`. |
| `format` | `(value: number) => string` | `Intl.NumberFormat()` | Custom number formatter. |
| `duration` | `number` | -- | Animation duration in ms. Defaults to the computed value of `--MOTION-DURATION-SHIFT` (or 400ms). |
| `children` | `ReactNode` | -- | Static content when `animateValue` is `false`. |
| `className` | `string` | -- | Additional CSS classes. |

### StatCard.Label

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | -- | Label text. |
| `className` | `string` | -- | Additional CSS classes. |

### StatCard.Trend

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | **required** | Percentage value to display (without the `%` sign). |
| `direction` | `"up" \| "down" \| "neutral"` | **required** | Trend direction. Determines color and arrow display. |
| `className` | `string` | -- | Additional CSS classes. |

Direction styling:
- `up`: Green (`--C-STATUS-SUCCESS`) with upward arrow.
- `down`: Red (`--C-STATUS-ERROR`) with downward arrow (rotated 180deg).
- `neutral`: Secondary text color, no arrow.

### StatCard.Icon

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | -- | Icon element (e.g., from Lucide React). |
| `className` | `string` | -- | Additional CSS classes. |

Renders a centered container with `--C-SURFACE-1` background and `--C-ACCENT` color.

## Animation

The count-up animation uses `requestAnimationFrame` with cubic ease-out (`1 - (1 - t)^3`). It triggers once when the element scrolls into view via `IntersectionObserver` (threshold: 0.1). When `prefers-reduced-motion: reduce` is active, the final value is displayed immediately without animation.

## Usage

### Basic StatCard

```tsx
import { StatCard } from "@/web/components/ui/StatCard";

<StatCard>
  <StatCard.Value>1,284</StatCard.Value>
  <StatCard.Label>Total Users</StatCard.Label>
</StatCard>
```

### With Trend Up

```tsx
<StatCard>
  <StatCard.Value>342</StatCard.Value>
  <StatCard.Label>Active Today</StatCard.Label>
  <StatCard.Trend direction="up" value={12} />
</StatCard>
```

### With Trend Down

```tsx
<StatCard>
  <StatCard.Value>28</StatCard.Value>
  <StatCard.Label>Open Issues</StatCard.Label>
  <StatCard.Trend direction="down" value={5} />
</StatCard>
```

### Animated Count-Up

```tsx
<StatCard>
  <StatCard.Value animateValue from={0} to={10000} />
  <StatCard.Label>Users Served</StatCard.Label>
  <StatCard.Trend direction="up" value={23} />
</StatCard>
```

### With Custom Formatter

```tsx
<StatCard>
  <StatCard.Value
    animateValue
    from={0}
    to={99.9}
    format={(v) => `${v.toFixed(1)}%`}
  />
  <StatCard.Label>Uptime</StatCard.Label>
</StatCard>
```

### With Icon

```tsx
import { Users } from "lucide-react";

<StatCard>
  <StatCard.Icon>
    <Users size={20} />
  </StatCard.Icon>
  <StatCard.Value animateValue from={0} to={5000} />
  <StatCard.Label>Registered Users</StatCard.Label>
  <StatCard.Trend direction="up" value={15} />
</StatCard>
```

### Dashboard Row

```tsx
import { Row } from "@/web/components/layout/Row";

<Row gap="r3" wrap className="w-full">
  <StatCard className="flex-1">
    <StatCard.Value animateValue to={10000} />
    <StatCard.Label>Users</StatCard.Label>
    <StatCard.Trend direction="up" value={23} />
  </StatCard>

  <StatCard className="flex-1">
    <StatCard.Value animateValue to={99.9} format={(v) => `${v.toFixed(1)}%`} />
    <StatCard.Label>Uptime</StatCard.Label>
  </StatCard>

  <StatCard className="flex-1">
    <StatCard.Value animateValue to={500} />
    <StatCard.Label>Deployments / day</StatCard.Label>
    <StatCard.Trend direction="up" value={8} />
  </StatCard>
</Row>
```

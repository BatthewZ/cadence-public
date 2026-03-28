# Breadcrumbs

Navigation breadcrumb trail with auto-inserted separators, collapsible overflow via `maxItems`, and link support through `react-router-dom`. Built as a compound component.

**Source:** `src/web/components/ui/Breadcrumbs.tsx`
**Styles:** `src/web/style/components/breadcrumbs.css`

## Compound API

| Component               | Element    | Purpose                                          |
| ----------------------- | ---------- | ------------------------------------------------ |
| `Breadcrumbs`           | `<nav>`    | Root provider. Renders `<ol>` list with separators auto-inserted between items. |
| `Breadcrumbs.Item`      | `<li>`     | Single breadcrumb entry. Renders a link, current-page indicator, or plain text. |
| `Breadcrumbs.Separator` | `<li>`     | Separator between items (auto-inserted by Root, rarely used directly). |

## Props

### Breadcrumbs (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `separator` | `ReactNode` | `"/"` | Custom separator element rendered between items. |
| `maxItems` | `number` | -- | When set, collapses the trail to show an ellipsis button if children exceed this count. |
| `itemsBeforeCollapse` | `number` | `1` | Number of items to show before the ellipsis when collapsed. |
| `itemsAfterCollapse` | `number` | `1` | Number of items to show after the ellipsis when collapsed. |
| `className` | `string` | -- | Additional CSS classes on the root `<nav>`. |

### Breadcrumbs.Item

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `href` | `string` | -- | Route path. Renders a `<Link>` from `react-router-dom`. Omit for non-link items. |
| `current` | `boolean` | `false` | Marks this item as the current page (`aria-current="page"`). Renders as a `<span>` instead of a link. |
| `className` | `string` | -- | Additional CSS classes on the `<li>`. |

### Breadcrumbs.Separator

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the separator `<li>`. |

The separator has `role="presentation"` and its content is wrapped in `aria-hidden="true"`.

## Collapsing

When `maxItems` is set and the number of children exceeds it, the trail collapses:

- Shows the first `itemsBeforeCollapse` items
- Renders an ellipsis button (`...`)
- Shows the last `itemsAfterCollapse` items

Clicking the ellipsis expands the full trail. The expansion is one-way (no re-collapse).

## Accessibility

- Root `<nav>` has `aria-label="Breadcrumb"`.
- Current page item has `aria-current="page"`.
- Separators use `role="presentation"` with `aria-hidden="true"` content.
- Ellipsis button has `aria-label="Show more breadcrumbs"`.
- Links have `:focus-visible` outline.
- `prefers-reduced-motion: reduce` disables hover/focus transitions.

## Usage

### Basic

```tsx
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";

<Breadcrumbs>
  <Breadcrumbs.Item href="/">Home</Breadcrumbs.Item>
  <Breadcrumbs.Item href="/products">Products</Breadcrumbs.Item>
  <Breadcrumbs.Item current>Widget Pro</Breadcrumbs.Item>
</Breadcrumbs>
```

### Custom Separator

```tsx
<Breadcrumbs separator="›">
  <Breadcrumbs.Item href="/">Home</Breadcrumbs.Item>
  <Breadcrumbs.Item href="/docs">Docs</Breadcrumbs.Item>
  <Breadcrumbs.Item current>API Reference</Breadcrumbs.Item>
</Breadcrumbs>
```

### Collapsible Trail

```tsx
<Breadcrumbs maxItems={3} itemsBeforeCollapse={1} itemsAfterCollapse={1}>
  <Breadcrumbs.Item href="/">Home</Breadcrumbs.Item>
  <Breadcrumbs.Item href="/category">Category</Breadcrumbs.Item>
  <Breadcrumbs.Item href="/category/sub">Subcategory</Breadcrumbs.Item>
  <Breadcrumbs.Item href="/category/sub/section">Section</Breadcrumbs.Item>
  <Breadcrumbs.Item current>Current Page</Breadcrumbs.Item>
</Breadcrumbs>
```

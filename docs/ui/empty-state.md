# EmptyState

Centered placeholder for empty views — no results, no data, first-time screens. Compound component with size variants controlled via React context.

**Source:** `src/web/components/ui/EmptyState.tsx`
**Styles:** `src/web/style/components/empty-state.css`

## Exports

| Export                  | Element | Purpose                                    |
| ----------------------- | ------- | ------------------------------------------ |
| `EmptyState`            | `<div>` | Root provider. Sets size via `data-size` attribute and context. |
| `EmptyStateIcon`        | `<div>` | Decorative icon slot (`aria-hidden="true"`). |
| `EmptyStateTitle`       | `<p>`   | Primary heading text.                      |
| `EmptyStateDescription` | `<p>`   | Secondary explanatory text (max-width 360px). |
| `EmptyStateActions`     | `<div>` | Action button row (flex, centered, wrapping). |

## Props

### EmptyState (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Controls padding, gap, and typography scale of all children. |
| `className` | `string` | -- | Additional CSS classes on the root `<div>`. |

### EmptyStateIcon

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes. |

### EmptyStateTitle

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes. |

### EmptyStateDescription

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes. |

### EmptyStateActions

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes. |

## Size Variants

| Size | Padding | Title Size | Icon Size |
| ---- | ------- | ---------- | --------- |
| `sm` | `--R-SIZE-5` | `--BodyText-1` | `--H5` |
| `md` | `--R-SIZE-3` | `--H5` | `--H4` |
| `lg` | `--R-SIZE-2` | `--H4` | `--H4` |

## Usage

### Basic

```tsx
import { EmptyState, EmptyStateDescription, EmptyStateIcon, EmptyStateTitle } from "@/web/components/ui/EmptyState";
import { Inbox } from "lucide-react";

<EmptyState>
  <EmptyStateIcon>
    <Inbox size={48} />
  </EmptyStateIcon>
  <EmptyStateTitle>No messages yet</EmptyStateTitle>
  <EmptyStateDescription>
    When you receive messages, they will appear here.
  </EmptyStateDescription>
</EmptyState>
```

### With Actions

```tsx
import { EmptyState, EmptyStateActions, EmptyStateDescription, EmptyStateIcon, EmptyStateTitle } from "@/web/components/ui/EmptyState";
import { Button } from "@/web/components/ui/Button";
import { Search } from "lucide-react";

<EmptyState size="lg">
  <EmptyStateIcon>
    <Search size={56} />
  </EmptyStateIcon>
  <EmptyStateTitle>No results found</EmptyStateTitle>
  <EmptyStateDescription>
    Try adjusting your search or filter criteria.
  </EmptyStateDescription>
  <EmptyStateActions>
    <Button variant="secondary">Clear Filters</Button>
    <Button>New Search</Button>
  </EmptyStateActions>
</EmptyState>
```

### Small Size

```tsx
<EmptyState size="sm">
  <EmptyStateTitle>Nothing here</EmptyStateTitle>
  <EmptyStateDescription>
    This list is empty.
  </EmptyStateDescription>
</EmptyState>
```

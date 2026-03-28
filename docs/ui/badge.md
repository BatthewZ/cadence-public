# Badge

Inline status or label indicator rendered as a `<span>`. Useful for tagging items with statuses, categories, or counts.

**Source:** `src/web/components/ui/Badge.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `"default" \| "success" \| "warning" \| "error" \| "info"` | `"default"` | Visual style indicating status or category. |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `ref` | `Ref<HTMLSpanElement>` | -- | Forwarded ref to the root `<span>`. |
| `...rest` | -- | -- | All remaining `<span>` props are spread onto the root element. |

### Base Classes

```
inline-flex items-center rounded-sm px-r5 py-r6 text-body-3 font-semibold
```

### Variant Classes

| Variant | Classes Applied |
| --- | --- |
| `default` | `bg-surface-2 text-fg-secondary` |
| `success` | `bg-status-success-bg text-status-success` |
| `warning` | `bg-status-warning-bg text-status-warning` |
| `error` | `bg-status-error-bg text-status-error` |
| `info` | `bg-status-info-bg text-status-info` |

## Usage

### All Variants

```tsx
import { Badge } from "@/web/components/ui/Badge";

<Badge variant="default">Default</Badge>
<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="error">Failed</Badge>
<Badge variant="info">New</Badge>
```

### Badge Inside a Card

```tsx
import { Card } from "@/web/components/ui/Card";
import { Text } from "@/web/components/ui/Text";
import { Row } from "@/web/components/layout/Row";
import { Badge } from "@/web/components/ui/Badge";

<Card>
  <Row justify="between">
    <Text variant="h6">Subscription Plan</Text>
    <Badge variant="success">Active</Badge>
  </Row>
</Card>
```

### Badge in a Table Row

```tsx
<tr>
  <td>Deployment #42</td>
  <td><Badge variant="warning">In Progress</Badge></td>
</tr>
```

### Badge with Custom Styling

```tsx
<Badge variant="info" className="gap-r6">
  <span className="size-2 rounded-full bg-current" />
  Live
</Badge>
```

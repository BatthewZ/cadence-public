# Card

Surface container with configurable padding, border radius, and shadow elevation. Renders a `<div>` with a light background suitable for content grouping.

**Source:** `src/web/components/ui/Card.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `padding` | `"r1" \| "r2" \| "r3" \| "r4" \| "r5" \| "r6"` | `"r3"` | Responsive padding using the spacing token scale. |
| `shadow` | `"sm" \| "md" \| "lg"` | `"md"` | Shadow elevation level. |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `ref` | `Ref<HTMLDivElement>` | -- | Forwarded ref to the root `<div>`. |
| `...rest` | -- | -- | All remaining `<div>` props are spread onto the root element. |

### Base Classes

```
bg-surface-0 rounded-lg shadow-{sm|md|lg} p-{r1..r6}
```

## Usage

### Basic Card

```tsx
import { Card } from "@/web/components/ui/Card";

<Card>
  <p>Card content goes here.</p>
</Card>
```

### Custom Padding

```tsx
<Card padding="r2">
  <p>More spacious card with larger responsive padding.</p>
</Card>

<Card padding="r5">
  <p>Compact card with tighter padding.</p>
</Card>
```

### Custom Shadow

```tsx
<Card shadow="sm">Subtle elevation</Card>
<Card shadow="md">Default elevation</Card>
<Card shadow="lg">High elevation (modals, popovers)</Card>
```

### Card with Header, Content, and Footer

Compose with layout primitives and `Text` to create structured cards.

```tsx
import { Card } from "@/web/components/ui/Card";
import { Text } from "@/web/components/ui/Text";
import { Stack } from "@/web/components/layout/Stack";
import { Divider } from "@/web/components/layout/Divider";
import { Row } from "@/web/components/layout/Row";
import { Button } from "@/web/components/ui/Button";

<Card padding="r2">
  <Stack gap="r4">
    {/* Header */}
    <Text variant="h5">Account Settings</Text>
    <Divider />

    {/* Content */}
    <Text variant="body-2" color="secondary">
      Manage your account preferences and billing information.
    </Text>

    {/* Footer */}
    <Row justify="end" gap="r5">
      <Button variant="ghost" size="sm">Cancel</Button>
      <Button variant="primary" size="sm">Save</Button>
    </Row>
  </Stack>
</Card>
```

### Card with Custom Class Overrides

```tsx
<Card className="w-full max-w-md border border-border-default">
  <p>Card with a border and constrained width.</p>
</Card>
```

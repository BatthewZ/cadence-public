# Spinner

Animated loading indicator rendered as a spinning circular border. Includes a screen-reader-only "Loading" label for accessibility (`role="status"`).

**Source:** `src/web/components/ui/Spinner.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Controls the diameter of the spinner. |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `ref` | `Ref<HTMLDivElement>` | -- | Forwarded ref to the root `<div>`. |
| `...rest` | -- | -- | All remaining `<div>` props (except `children`) are spread onto the root element. |

### Base Classes

```
animate-spin rounded-full border-2 border-current border-t-transparent
```

### Size Classes

| Size | Class | Dimensions |
| --- | --- | --- |
| `sm` | `size-4` | 16px |
| `md` | `size-6` | 24px |
| `lg` | `size-8` | 32px |

### Accessibility

The spinner renders with `role="status"` and contains a visually hidden `<span className="sr-only">Loading</span>` for screen readers.

## Usage

### Basic Spinner

```tsx
import { Spinner } from "@/web/components/ui/Spinner";

<Spinner />
```

### All Sizes

```tsx
<Spinner size="sm" />
<Spinner size="md" />
<Spinner size="lg" />
```

### Custom Color

The spinner uses `border-current`, so it inherits the text color of its parent. Override with a `className`.

```tsx
<Spinner className="text-accent" />
<Spinner className="text-status-success" />
<Spinner className="text-status-error" />
```

### Inline with Text

```tsx
import { Row } from "@/web/components/layout/Row";
import { Text } from "@/web/components/ui/Text";
import { Spinner } from "@/web/components/ui/Spinner";

<Row gap="r5">
  <Spinner size="sm" />
  <Text variant="body-2" color="secondary">Loading data...</Text>
</Row>
```

### Centered Loading State

```tsx
import { Center } from "@/web/components/layout/Center";
import { Spinner } from "@/web/components/ui/Spinner";

<Center className="min-h-[200px]">
  <Spinner size="lg" />
</Center>
```

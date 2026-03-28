# Skeleton

Placeholder loading component that renders a pulsing shape to indicate content is loading. Supports text lines, circular avatars, rectangles, and rounded rectangles.

**Source:** `src/web/components/ui/Skeleton.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `"text" \| "circular" \| "rectangular" \| "rounded"` | `"text"` | Shape of the skeleton placeholder. |
| `width` | `string \| number` | `"100%"` | Width of the skeleton. Accepts CSS values (e.g., `"200px"`, `"50%"`) or numbers (treated as pixels). |
| `height` | `string \| number` | -- | Height of the skeleton. When omitted, determined by the variant's CSS class. |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `style` | `CSSProperties` | -- | Inline styles merged with `width` and `height`. |
| `ref` | `Ref<HTMLSpanElement>` | -- | Forwarded ref to the root `<span>`. |
| `...rest` | -- | -- | All remaining `<span>` props (except `children`) are spread onto the root element. |

### Variant CSS Classes

| Variant | CSS Class | Description |
| --- | --- | --- |
| `text` | `skeleton--text` | Simulates a line of text. |
| `circular` | `skeleton--circular` | Circular shape for avatar placeholders. |
| `rectangular` | *(none)* | Plain rectangle; relies on `width` and `height` props. |
| `rounded` | `skeleton--rounded` | Rectangle with rounded corners. |

All variants also receive the `skeleton` base CSS class, which provides the pulsing animation.

### Accessibility

The skeleton renders with `role="status"` and `aria-label="Loading"`, plus a visually hidden `<span className="sr-only">Loading</span>` for screen readers.

## Usage

### Text Placeholder

```tsx
import { Skeleton } from "@/web/components/ui/Skeleton";

<Skeleton variant="text" />
<Skeleton variant="text" width="75%" />
<Skeleton variant="text" width="50%" />
```

### Circular Placeholder (Avatar)

```tsx
<Skeleton variant="circular" width={40} height={40} />
<Skeleton variant="circular" width={64} height={64} />
```

### Rectangular Placeholder (Image/Banner)

```tsx
<Skeleton variant="rectangular" width="100%" height={200} />
```

### Rounded Placeholder

```tsx
<Skeleton variant="rounded" width={300} height={120} />
```

## CommentSkeletonList

Pre-composed skeleton layout that renders three placeholder comment cards. Used by `TaskDetailDialog` and `TaskDetailPanel` to show a loading state while comments are being fetched.

Each card mimics a comment with a circular avatar skeleton, two text-line skeletons for the author/timestamp header, and two text-line skeletons for the comment body.

### Usage

```tsx
import { CommentSkeletonList } from "@/web/components/ui/Skeleton";

{isCommentsLoading && <CommentSkeletonList />}
```

---

### Composing a Loading Card

```tsx
import { Card } from "@/web/components/ui/Card";
import { Stack } from "@/web/components/layout/Stack";
import { Row } from "@/web/components/layout/Row";
import { Skeleton } from "@/web/components/ui/Skeleton";

<Card>
  <Stack gap="r4">
    <Row gap="r4">
      <Skeleton variant="circular" width={40} height={40} />
      <Stack gap="r6" className="flex-1">
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="text" width="60%" />
      </Stack>
    </Row>
    <Skeleton variant="rectangular" width="100%" height={160} />
    <Skeleton variant="text" />
    <Skeleton variant="text" width="80%" />
  </Stack>
</Card>
```

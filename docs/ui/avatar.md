# Avatar

User avatar component that displays an image with automatic fallback to initials derived from a `name` prop. Includes an optional status indicator dot. Pair with `AvatarGroup` for overlapping stacks with a `+N` overflow count.

**Source:** `src/web/components/ui/Avatar.tsx`

## Avatar Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string \| null` | -- | Image URL. Falls back to initials when `null`, empty, or the image fails to load. |
| `alt` | `string` | -- | Explicit alt text. Falls back to `name` if not provided. |
| `name` | `string` | -- | User's name, used to derive initials (first letter of first and last word) and as fallback alt text. |
| `size` | `"xs" \| "sm" \| "md" \| "lg" \| "xl"` | `"md"` | Controls the avatar dimensions. |
| `status` | `"online" \| "offline" \| "away"` | -- | Optional status indicator dot rendered at the bottom-right corner. |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `ref` | `Ref<HTMLSpanElement>` | -- | Forwarded ref to the root `<span>`. |
| `...rest` | -- | -- | All remaining `<span>` props are spread onto the root element. |

### Size Classes

| Size | Class | Dimensions | Initials Text | Status Dot Size |
| --- | --- | --- | --- | --- |
| `xs` | `size-6` | 24px | `text-[10px]` | `size-2` |
| `sm` | `size-8` | 32px | `text-body-3` | `size-2` |
| `md` | `size-10` | 40px | `text-body-2` | `size-2.5` |
| `lg` | `size-12` | 48px | `text-body-1` | `size-3` |
| `xl` | `size-16` | 64px | `text-h3` | `size-3` |

### Status Colors

| Status | Color Class |
| --- | --- |
| `online` | `bg-status-success` |
| `offline` | `bg-surface-3` |
| `away` | `bg-status-warning` |

### Initials Logic

Initials are derived from the `name` prop:
- Single word: first character, uppercased (e.g., `"Alice"` becomes `"A"`).
- Multiple words: first character of the first and second word, uppercased (e.g., `"Jane Doe"` becomes `"JD"`).

## AvatarGroup Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `max` | `number` | -- | Maximum number of avatars to display. Extra avatars are represented by a `+N` overflow indicator. |
| `size` | `"xs" \| "sm" \| "md" \| "lg" \| "xl"` | `"md"` | Controls overlap spacing between avatars. |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `ref` | `Ref<HTMLDivElement>` | -- | Forwarded ref to the root `<div>`. |
| `...rest` | -- | -- | All remaining `<div>` props are spread onto the root element. |

### Overlap Spacing

| Size | Negative Margin |
| --- | --- |
| `xs` | `-space-x-1.5` |
| `sm` | `-space-x-2` |
| `md` | `-space-x-2.5` |
| `lg` | `-space-x-3` |
| `xl` | `-space-x-3.5` |

Each child avatar receives a `ring-2 ring-surface-0` border for the "cutout" effect.

## Usage

### Avatar with Image

```tsx
import { Avatar } from "@/web/components/ui/Avatar";

<Avatar src="/images/user.jpg" name="Jane Doe" />
```

### Initials Fallback

When no `src` is provided or the image fails to load, initials are displayed.

```tsx
<Avatar name="Jane Doe" />
<Avatar name="Alice" />
```

### All Sizes

```tsx
<Avatar name="JD" size="xs" />
<Avatar name="JD" size="sm" />
<Avatar name="JD" size="md" />
<Avatar name="JD" size="lg" />
<Avatar name="JD" size="xl" />
```

### Status Indicator

```tsx
<Avatar name="Jane Doe" src="/images/user.jpg" status="online" />
<Avatar name="Bob Smith" status="away" />
<Avatar name="Eve" status="offline" />
```

### AvatarGroup

```tsx
import { Avatar, AvatarGroup } from "@/web/components/ui/Avatar";

<AvatarGroup max={3} size="md">
  <Avatar name="Alice" src="/images/alice.jpg" />
  <Avatar name="Bob" src="/images/bob.jpg" />
  <Avatar name="Charlie" />
  <Avatar name="Diana" />
  <Avatar name="Eve" />
</AvatarGroup>
{/* Renders 3 avatars + a "+2" overflow indicator */}
```

### AvatarGroup Without Limit

```tsx
<AvatarGroup size="sm">
  <Avatar name="Alice" />
  <Avatar name="Bob" />
  <Avatar name="Charlie" />
</AvatarGroup>
```

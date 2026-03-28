# IconButton

Square icon-only button designed for toolbar actions, close buttons, and compact controls. Requires an `aria-label` for accessibility.

**Source:** `src/web/components/ui/IconButton.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `aria-label` | `string` | **(required)** | Accessible label describing the button's action. Required in the type definition. |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `disabled` | `boolean` | `false` | Disables the button (50% opacity, `not-allowed` cursor). |
| `ref` | `Ref<HTMLButtonElement>` | -- | Forwarded ref to the root `<button>`. |
| `...rest` | -- | -- | All remaining `<button>` props are spread onto the root element. |

### Base Classes

```
inline-flex items-center justify-center rounded-md
p-r5 text-fg-secondary hover:bg-surface-2 active:bg-surface-3 active:scale-95
duration-fast cursor-pointer
disabled:opacity-50 disabled:cursor-not-allowed
ring-2 ring-transparent focus-visible:ring-border-focus focus-visible:ring-offset-2
```

## Usage

### Basic Icon Button

```tsx
import { IconButton } from "@/web/components/ui/IconButton";
import { X } from "lucide-react";

<IconButton aria-label="Close">
  <X className="size-5" />
</IconButton>
```

### Common Actions with Lucide Icons

```tsx
import { IconButton } from "@/web/components/ui/IconButton";
import { Settings, Bell, Search, Menu, MoreVertical } from "lucide-react";

<IconButton aria-label="Settings">
  <Settings className="size-5" />
</IconButton>

<IconButton aria-label="Notifications">
  <Bell className="size-5" />
</IconButton>

<IconButton aria-label="Search">
  <Search className="size-5" />
</IconButton>

<IconButton aria-label="Open menu">
  <Menu className="size-5" />
</IconButton>

<IconButton aria-label="More options">
  <MoreVertical className="size-5" />
</IconButton>
```

### Disabled State

```tsx
import { Trash2 } from "lucide-react";

<IconButton aria-label="Delete" disabled>
  <Trash2 className="size-5" />
</IconButton>
```

### Custom Styling

Override colors or size with `className`.

```tsx
import { Heart } from "lucide-react";

<IconButton aria-label="Favorite" className="text-status-error hover:bg-status-error-bg">
  <Heart className="size-5" />
</IconButton>
```

### In a Toolbar

```tsx
import { Row } from "@/web/components/layout/Row";
import { IconButton } from "@/web/components/ui/IconButton";
import { Bold, Italic, Underline, AlignLeft } from "lucide-react";

<Row gap="r6">
  <IconButton aria-label="Bold"><Bold className="size-4" /></IconButton>
  <IconButton aria-label="Italic"><Italic className="size-4" /></IconButton>
  <IconButton aria-label="Underline"><Underline className="size-4" /></IconButton>
  <IconButton aria-label="Align left"><AlignLeft className="size-4" /></IconButton>
</Row>
```

# Button

Interactive button component with multiple variants, sizes, and a polymorphic `as` prop for rendering as any HTML element or React component (e.g., a router `Link`).

**Source:** `src/web/components/ui/Button.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `"primary" \| "secondary" \| "ghost" \| "ghost-inverse" \| "danger" \| "link"` | `"primary"` | Visual style of the button. |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Controls padding, font size, and border radius. |
| `as` | `ElementType` | `"button"` | Polymorphic element type. Accepts any HTML tag or React component. |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `disabled` | `boolean` | `false` | Disables the button (50% opacity, `not-allowed` cursor). |
| `ref` | `Ref<HTMLElement>` | -- | Forwarded ref to the root element. |
| `...rest` | -- | -- | All remaining props are spread onto the rendered element. |

### Variant Classes

| Variant | Classes Applied |
| --- | --- |
| `primary` | `bg-primary text-fg-on-primary hover:bg-primary-hover active:bg-primary-active` |
| `secondary` | `bg-secondary text-fg-primary hover:bg-secondary-hover` |
| `ghost` | `bg-transparent text-fg-secondary hover:bg-surface-2` |
| `ghost-inverse` | `bg-transparent text-fg-on-primary hover:bg-white/15` |
| `danger` | `bg-status-error text-fg-inverse hover:bg-status-error/90` |
| `link` | `text-accent hover:underline font-bold` |

### Size Classes

| Size | Classes Applied |
| --- | --- |
| `sm` | `text-body-3 px-r5 py-r6 rounded-md` |
| `md` | `text-body-2 px-r3 py-r5 rounded-md` |
| `lg` | `text-body-1 px-r2 py-r4 rounded-md` |

### Shared Base Classes

All buttons share the following base styles:

```
inline-flex items-center justify-center font-semibold whitespace-nowrap
duration-fast cursor-pointer
disabled:opacity-50 disabled:cursor-not-allowed
ring-2 ring-transparent focus-visible:ring-border-focus focus-visible:ring-offset-2
```

## Usage

### Basic Primary Button

```tsx
import { Button } from "@/web/components/ui/Button";

<Button>Save Changes</Button>
```

### Variants

```tsx
<Button variant="primary">Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="ghost-inverse">Ghost Inverse</Button>
<Button variant="danger">Delete Account</Button>
<Button variant="link">Learn more</Button>
```

### Sizes

```tsx
<Button size="sm">Small</Button>
<Button size="md">Medium</Button>
<Button size="lg">Large</Button>
```

### As a Router Link

Use the `as` prop to render the button as a different element. This is useful for navigation links that should look like buttons.

```tsx
import { Link } from "react-router-dom";
import { Button } from "@/web/components/ui/Button";

<Button as={Link} to="/dashboard" variant="primary" size="lg">
  Go to Dashboard
</Button>
```

### Disabled State

```tsx
<Button disabled>Cannot Click</Button>
<Button variant="secondary" disabled>Disabled Secondary</Button>
```

### With Icons

Pair with Lucide React icons. The `inline-flex items-center` base class keeps the icon and text aligned.

```tsx
import { Plus, Trash2 } from "lucide-react";

<Button variant="primary" size="md">
  <Plus className="size-4 mr-r6" />
  Add Item
</Button>

<Button variant="danger" size="sm">
  <Trash2 className="size-4 mr-r6" />
  Remove
</Button>
```

### Full-Width Button

```tsx
<Button className="w-full" variant="primary" size="lg">
  Sign In
</Button>
```

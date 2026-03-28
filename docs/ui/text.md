# Text

Typography primitive that wraps the responsive text scale. Automatically renders the appropriate semantic HTML element based on the variant (`<h1>`-`<h6>` for headings, `<p>` for body text), or any element via the polymorphic `as` prop.

**Source:** `src/web/components/ui/Text.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `"h1" \| "h2" \| "h3" \| "h4" \| "h5" \| "h6" \| "body-1" \| "body-2" \| "body-3"` | `"body-1"` | Typography scale variant. Controls font size and line height (responsive). |
| `weight` | `"semibold" \| "bold"` | -- | Optional font weight override. Applies `font-semibold` or `font-bold`. |
| `color` | `"primary" \| "secondary" \| "muted" \| "inverse" \| "on-primary"` | `"primary"` | Text color using semantic color tokens. |
| `as` | `ElementType` | Auto from variant | Polymorphic element type. Overrides the default element for the variant. |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `ref` | `Ref<HTMLElement>` | -- | Forwarded ref to the root element. |
| `...rest` | -- | -- | All remaining props are spread onto the rendered element. |

### Default Element Mapping

| Variant | Default Element |
| --- | --- |
| `h1` | `<h1>` |
| `h2` | `<h2>` |
| `h3` | `<h3>` |
| `h4` | `<h4>` |
| `h5` | `<h5>` |
| `h6` | `<h6>` |
| `body-1` | `<p>` |
| `body-2` | `<p>` |
| `body-3` | `<p>` |

### Color Mapping

| Color | Tailwind Class | Purpose |
| --- | --- | --- |
| `primary` | `text-fg-primary` | Headings, primary content |
| `secondary` | `text-fg-secondary` | Body text, descriptions |
| `muted` | `text-fg-muted` | Placeholders, hints |
| `inverse` | `text-fg-inverse` | Text on dark backgrounds |
| `on-primary` | `text-fg-on-primary` | Text on primary-colored surfaces |

## Usage

### Headings

```tsx
import { Text } from "@/web/components/ui/Text";

<Text variant="h1">Page Title</Text>
<Text variant="h2">Section Heading</Text>
<Text variant="h3">Subsection</Text>
<Text variant="h4">Card Heading</Text>
<Text variant="h5">Small Heading</Text>
<Text variant="h6">Label Heading</Text>
```

### Body Text

```tsx
<Text variant="body-1">Standard body text at 14/16px responsive.</Text>
<Text variant="body-2">Smaller body text for descriptions.</Text>
<Text variant="body-3">Caption-sized text for fine print.</Text>
```

### Colored Text

```tsx
<Text color="primary">Primary text color</Text>
<Text color="secondary">Secondary text for descriptions</Text>
<Text color="muted">Muted text for hints and placeholders</Text>
<Text color="inverse">Inverse text for dark backgrounds</Text>
<Text color="on-primary">Text on primary-colored surfaces</Text>
```

### Weighted Text

```tsx
<Text variant="body-1" weight="semibold">Semibold body text</Text>
<Text variant="body-1" weight="bold">Bold body text</Text>
```

### Polymorphic `as` Prop

Render a heading-sized `<span>` or body-text-styled `<label>`.

```tsx
<Text variant="h3" as="span">
  Heading-styled span (no semantic heading)
</Text>

<Text variant="body-2" as="label" htmlFor="name">
  Form Label
</Text>
```

### Truncated Text

Use a `className` override to truncate long text.

```tsx
<Text variant="body-2" className="truncate max-w-xs">
  This is a very long piece of text that will be truncated with an ellipsis when
  it overflows its container.
</Text>
```

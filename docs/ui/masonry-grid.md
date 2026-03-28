# MasonryGrid

CSS columns-based variable-height grid layout with responsive column counts and optional scroll-reveal animation. Built as a compound component.

**Source:** `src/web/components/ui/MasonryGrid.tsx`
**Styles:** `src/web/style/components/masonry-grid.css`

## Compound API

| Component          | Element | Purpose                                                |
| ------------------ | ------- | ------------------------------------------------------ |
| `MasonryGrid`      | `<div>` | Root container. Sets column count and gap.             |
| `MasonryGrid.Item` | `<div>` | Individual grid item with `break-inside: avoid`.        |

## Props

### MasonryGrid (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `columns` | `number \| ColumnBreakpoints` | `1` | Column count. Pass a number for all breakpoints, or an object for responsive values. |
| `gap` | `string` | -- | Custom gap value. Sets `--masonry-gap` CSS variable. Defaults to `var(--R-SIZE-4)` if not set. |
| `animate` | `boolean` | `true` | Enables `ScrollReveal` entrance animation on items. |
| `animation` | `"fade-up" \| "fade-in" \| "fade-left" \| "fade-right" \| "scale"` | `"fade-up"` | Animation type for items when `animate` is `true`. |
| `className` | `string` | -- | Additional CSS classes. |
| `style` | `CSSProperties` | -- | Inline styles (merged with gap variable). |

#### ColumnBreakpoints

```ts
type ColumnBreakpoints = {
  base?: number;  // All sizes (no media query)
  sm?: number;    // >= 640px
  md?: number;    // >= 768px
  lg?: number;    // >= 1024px
  xl?: number;    // >= 1280px
};
```

Supported column counts are 1 through 4. The CSS provides pre-built classes for each breakpoint/count combination (e.g., `masonry-grid--md-2`, `masonry-grid--lg-3`).

### MasonryGrid.Item

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the item. |

When `animate` is `true` on the parent, each item is wrapped in `ScrollReveal` with a staggered delay of `index * 50ms`.

## Usage

### Responsive Columns with Cards

```tsx
import { MasonryGrid } from "@/web/components/ui/MasonryGrid";
import { Card } from "@/web/components/ui/Card";

<MasonryGrid columns={{ sm: 1, md: 2, lg: 3 }}>
  <MasonryGrid.Item>
    <Card>
      <h3 className="text-h6 font-semibold">Short Card</h3>
      <p className="text-body-2 text-text-secondary">Brief content.</p>
    </Card>
  </MasonryGrid.Item>

  <MasonryGrid.Item>
    <Card>
      <h3 className="text-h6 font-semibold">Tall Card</h3>
      <p className="text-body-2 text-text-secondary">
        This card has much more content and will take up more vertical space,
        demonstrating the masonry layout behavior where items fill available
        column space without leaving gaps.
      </p>
    </Card>
  </MasonryGrid.Item>

  <MasonryGrid.Item>
    <Card>
      <h3 className="text-h6 font-semibold">Medium Card</h3>
      <p className="text-body-2 text-text-secondary">
        Moderate amount of content here.
      </p>
    </Card>
  </MasonryGrid.Item>

  <MasonryGrid.Item>
    <Card>
      <h3 className="text-h6 font-semibold">Another Card</h3>
      <p className="text-body-2 text-text-secondary">More content.</p>
    </Card>
  </MasonryGrid.Item>
</MasonryGrid>
```

### Fixed Column Count

```tsx
<MasonryGrid columns={2} gap="var(--R-SIZE-3)">
  {items.map((item) => (
    <MasonryGrid.Item key={item.id}>
      <Card>{item.content}</Card>
    </MasonryGrid.Item>
  ))}
</MasonryGrid>
```

### Without Animation

```tsx
<MasonryGrid columns={{ md: 2, lg: 4 }} animate={false}>
  {items.map((item) => (
    <MasonryGrid.Item key={item.id}>
      <img src={item.src} alt={item.alt} className="rounded-lg" />
    </MasonryGrid.Item>
  ))}
</MasonryGrid>
```

### Photo Gallery

```tsx
<MasonryGrid columns={{ sm: 2, md: 3, lg: 4 }} animation="scale">
  {photos.map((photo) => (
    <MasonryGrid.Item key={photo.id}>
      <img
        src={photo.url}
        alt={photo.caption}
        className="w-full rounded-lg"
      />
    </MasonryGrid.Item>
  ))}
</MasonryGrid>
```

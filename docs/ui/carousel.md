# Carousel

Horizontally scrollable content container with CSS scroll-snap, navigation arrows, drag-to-scroll, and keyboard support. Built as a compound component.

**Source:** `src/web/components/ui/Carousel.tsx`
**Styles:** `src/web/style/components/carousel.css`

## Compound API

| Component        | Element  | Purpose                                                    |
| ---------------- | -------- | ---------------------------------------------------------- |
| `Carousel`       | `<div>`  | Root container. Manages scroll state and renders nav arrows.|
| `Carousel.Track` | `<div>`  | Scrollable flex track. Handles drag-to-scroll.             |
| `Carousel.Item`  | `<div>`  | Individual slide with `role="group"` and `aria-roledescription="slide"`. |

## Props

### Carousel (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `ReactNode` | -- | Optional title rendered above the track. |
| `className` | `string` | -- | Additional CSS classes on the root container. |

### Carousel.Track

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the scroll track. |

### Carousel.Item

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the slide. |

## CSS Token Integration

| CSS Variable | Default | Purpose |
| --- | --- | --- |
| `--MEDIA-CAROUSEL-PEEK` | `48px` | Visible portion of the next/previous item, applied as `padding-inline` on the track. |
| `--MEDIA-CAROUSEL-GAP` | `var(--R-SIZE-5)` | Gap between carousel items. |

Override these tokens at the theme level or via inline styles to customize spacing.

## Navigation

### Arrow Buttons

Previous and Next arrow buttons are rendered as `IconButton` components. They are positioned absolutely at the vertical center of the carousel. Buttons auto-hide (`opacity: 0; pointer-events: none`) when the track cannot scroll further in that direction.

### Drag-to-Scroll

The `Carousel.Track` supports mouse drag scrolling. During a drag, scroll-snap is temporarily disabled and `cursor: grabbing` is applied. If the user releases with velocity, the track animates to the next/previous frame. Click events on children are suppressed after a drag to prevent accidental activation.

### Keyboard

| Key | Behavior |
| --- | --- |
| `ArrowLeft` | Scroll one frame to the left. |
| `ArrowRight` | Scroll one frame to the right. |

Keyboard events are handled on the root `Carousel` element (which is focusable via `tabIndex={0}`).

## Accessibility

- `aria-roledescription="carousel"` on the root.
- `aria-label="Carousel"` fallback, or `aria-labelledby` if a `title` is provided.
- Each `Carousel.Item` has `role="group"` and `aria-roledescription="slide"`.
- `Carousel.Track` has `role="region"` with `aria-label="Carousel items"`.
- `prefers-reduced-motion: reduce` disables smooth scroll behavior and arrow fade transitions.

## Usage

### Basic Carousel

```tsx
import { Carousel } from "@/web/components/ui/Carousel";

<Carousel>
  <Carousel.Track>
    <Carousel.Item>Slide 1</Carousel.Item>
    <Carousel.Item>Slide 2</Carousel.Item>
    <Carousel.Item>Slide 3</Carousel.Item>
  </Carousel.Track>
</Carousel>
```

### With MediaCards

```tsx
import { Carousel } from "@/web/components/ui/Carousel";
import { MediaCard } from "@/web/components/ui/MediaCard";

<Carousel title={<h2 className="text-h4 font-bold">Trending Now</h2>}>
  <Carousel.Track>
    {items.map((item) => (
      <Carousel.Item key={item.id}>
        <MediaCard orientation="portrait">
          <MediaCard.Image src={item.poster} alt={item.name} />
          <MediaCard.Overlay />
          <MediaCard.Content>
            <h3 className="text-body-2 font-semibold text-text-inverse">
              {item.name}
            </h3>
          </MediaCard.Content>
        </MediaCard>
      </Carousel.Item>
    ))}
  </Carousel.Track>
</Carousel>
```

### Landscape Cards

```tsx
<Carousel>
  <Carousel.Track>
    {events.map((event) => (
      <Carousel.Item key={event.id} className="w-[300px]">
        <MediaCard orientation="landscape">
          <MediaCard.Image src={event.banner} alt={event.name} />
          <MediaCard.Overlay />
          <MediaCard.Content>
            <h3 className="text-body-2 font-semibold text-text-inverse">
              {event.name}
            </h3>
          </MediaCard.Content>
        </MediaCard>
      </Carousel.Item>
    ))}
  </Carousel.Track>
</Carousel>
```

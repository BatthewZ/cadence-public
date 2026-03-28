# Spotlight

Alternating image + text feature sections for marketing landing pages. Built as a compound component with auto-alternating layout and optional scroll animation.

**Source:** `src/web/components/ui/Spotlight.tsx`
**Styles:** `src/web/style/components/spotlight.css`

## Compound API

| Component          | Element | Purpose                                              |
| ------------------ | ------- | ---------------------------------------------------- |
| `Spotlight`        | `<div>` | Root container. Manages item indexing and animation.  |
| `Spotlight.Item`   | `<div>` | Grid row for one feature section (image + content).  |
| `Spotlight.Image`  | `<div>` | Image container with optional parallax.              |
| `Spotlight.Content`| `<div>` | Text content area with optional scroll-reveal.       |

## Props

### Spotlight (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `animate` | `boolean` | `true` | Enables `ScrollReveal` entrance animation on content areas. |
| `className` | `string` | -- | Additional CSS classes on the root container. |

### Spotlight.Item

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `reversed` | `boolean` | -- | Force the image to appear on the opposite side. Without this, even-indexed items auto-reverse via CSS `:nth-child(even)`. |
| `className` | `string` | -- | Additional CSS classes. |

### Spotlight.Image

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string` | **required** | Image source URL. |
| `alt` | `string` | -- | Alt text. If omitted, image is marked `role="presentation"`. |
| `parallax` | `boolean` | `false` | Enables parallax scroll effect. |
| `parallaxRate` | `number` | -- | Custom parallax speed ratio. |
| `className` | `string` | -- | Additional CSS classes on the image container. |

### Spotlight.Content

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the content container. |

When `animate` is `true` on the parent `Spotlight`, content animates in via `ScrollReveal` with alternating `fade-right` (odd items) and `fade-left` (even items) animations.

## Layout

- **Mobile** (< 640px): Single column, stacked vertically.
- **Desktop** (>= 640px): Two-column grid with auto-alternating image/content sides.
  - Odd items: image left, content right.
  - Even items: image right, content left (via CSS `order`).
  - The `reversed` prop flips this behavior for manual control.

The root `Spotlight` container spaces items with `gap: var(--R-SIZE-2)`.

## Usage

### Alternating Feature Sections

```tsx
import { Spotlight } from "@/web/components/ui/Spotlight";

<Spotlight>
  <Spotlight.Item>
    <Spotlight.Image src="/images/feature-speed.jpg" alt="Fast dashboard" />
    <Spotlight.Content>
      <h3 className="text-h3 font-bold">Lightning Fast</h3>
      <p className="text-body-1 text-text-secondary">
        Deployed to the edge, milliseconds from your users.
      </p>
    </Spotlight.Content>
  </Spotlight.Item>

  <Spotlight.Item>
    <Spotlight.Image src="/images/feature-scale.jpg" alt="Scaling graph" />
    <Spotlight.Content>
      <h3 className="text-h3 font-bold">Built to Scale</h3>
      <p className="text-body-1 text-text-secondary">
        From prototype to production without changing a line.
      </p>
    </Spotlight.Content>
  </Spotlight.Item>

  <Spotlight.Item>
    <Spotlight.Image src="/images/feature-secure.jpg" alt="Security shield" />
    <Spotlight.Content>
      <h3 className="text-h3 font-bold">Secure by Default</h3>
      <p className="text-body-1 text-text-secondary">
        Enterprise-grade security built in from day one.
      </p>
    </Spotlight.Content>
  </Spotlight.Item>
</Spotlight>
```

### Manually Reversed Item

```tsx
<Spotlight>
  <Spotlight.Item reversed>
    <Spotlight.Image src="/images/hero-feature.jpg" alt="Feature image" />
    <Spotlight.Content>
      <h3 className="text-h3 font-bold">Image on the Right</h3>
      <p className="text-body-1 text-text-secondary">
        Use the reversed prop to force image-right on an odd item.
      </p>
    </Spotlight.Content>
  </Spotlight.Item>
</Spotlight>
```

### With Parallax

```tsx
<Spotlight>
  <Spotlight.Item>
    <Spotlight.Image
      src="/images/deep-feature.jpg"
      alt="Feature with depth"
      parallax
      parallaxRate={0.3}
    />
    <Spotlight.Content>
      <h3 className="text-h3 font-bold">Depth Effect</h3>
      <p className="text-body-1 text-text-secondary">
        Parallax adds subtle depth to feature images.
      </p>
    </Spotlight.Content>
  </Spotlight.Item>
</Spotlight>
```

### Without Animation

```tsx
<Spotlight animate={false}>
  <Spotlight.Item>
    <Spotlight.Image src="/images/static-feature.jpg" alt="Static feature" />
    <Spotlight.Content>
      <h3 className="text-h3 font-bold">No Animation</h3>
      <p className="text-body-1 text-text-secondary">
        Content appears immediately without scroll reveal.
      </p>
    </Spotlight.Content>
  </Spotlight.Item>
</Spotlight>
```

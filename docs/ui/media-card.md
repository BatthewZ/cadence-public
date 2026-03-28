# MediaCard

Image card with gradient overlay, hover effects, and metadata slots. Designed for media-rich browsing experiences. Built as a compound component.

**Source:** `src/web/components/ui/MediaCard.tsx`
**Styles:** `src/web/style/components/media-card.css`

## Compound API

| Component          | Element     | Purpose                                                  |
| ------------------ | ----------- | -------------------------------------------------------- |
| `MediaCard`        | `<article>` | Root container. Sets orientation context for children.   |
| `MediaCard.Image`  | `<img>`     | Aspect-ratio image container. Lazy-loaded by default.    |
| `MediaCard.Overlay`| `<div>`     | Gradient overlay from transparent to dark (bottom-up).   |
| `MediaCard.Content`| `<div>`     | Absolutely-positioned content area at the bottom.        |
| `MediaCard.Badge`  | `<div>`     | Absolutely-positioned badge slot in the top-right corner.|
| `MediaCard.Action` | `<div>`     | Centered overlay slot for action buttons (e.g., play).   |

## Props

### MediaCard (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `orientation` | `"portrait" \| "landscape" \| "square"` | `"portrait"` | Sets the aspect ratio of the image container. |
| `className` | `string` | -- | Additional CSS classes on the `<article>`. |

### MediaCard.Image

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `alt` | `string` | **required** | Alt text for the image. |
| `src` | `string` | -- | Image source URL. |
| `className` | `string` | -- | Additional CSS classes on the `<img>` element. |

Images are `loading="lazy"` by default and rendered as `object-cover` inside the aspect-ratio container.

### MediaCard.Overlay

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the overlay. |

Renders a `linear-gradient(to top, --OVERLAY-GRADIENT-END, --OVERLAY-GRADIENT-START)`. Marked `aria-hidden="true"`.

### MediaCard.Content

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the content container. |

Positioned `absolute inset-x-0 bottom-0` with padding `p-r3`.

### MediaCard.Badge

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the badge container. |

Positioned `absolute top-r5 right-r5 z-10`.

### MediaCard.Action

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the action container. |

Positioned `absolute inset-0 z-10` with centered flex alignment.

## Aspect Ratios

| Orientation | CSS Variable | Default Ratio |
| --- | --- | --- |
| `portrait` | `--MEDIA-ASPECT-POSTER` | `2 / 3` |
| `landscape` | `--MEDIA-ASPECT-WIDE` | `16 / 9` |
| `square` | `--MEDIA-ASPECT-SQUARE` | `1 / 1` |

## Hover Effects

On hover the card scales up and lifts via CSS `transform`:

| Token | Default | Effect |
| --- | --- | --- |
| `--MEDIA-CARD-HOVER-SCALE` | `1.05` | Scale factor on hover. |
| `--MEDIA-CARD-HOVER-LIFT` | `-4px` | Y-axis translate on hover. |

Shadow elevates from `--SHADOW-SM` to `--SHADOW-LG`. Both the transform and shadow transitions use `--MOTION-DURATION-ENTER` and `--MOTION-EASE-ENTER`. Transform is disabled when `prefers-reduced-motion: reduce`.

## Usage

### Portrait Card

```tsx
import { MediaCard } from "@/web/components/ui/MediaCard";

<MediaCard orientation="portrait">
  <MediaCard.Image src="/images/movie-poster.jpg" alt="Movie title" />
  <MediaCard.Overlay />
  <MediaCard.Content>
    <h3 className="text-body-2 font-semibold text-text-inverse">Movie Title</h3>
  </MediaCard.Content>
</MediaCard>
```

### Landscape Card

```tsx
<MediaCard orientation="landscape">
  <MediaCard.Image src="/images/event-banner.jpg" alt="Concert event" />
  <MediaCard.Overlay />
  <MediaCard.Content>
    <h3 className="text-body-2 font-semibold text-text-inverse">Summer Concert</h3>
    <p className="text-body-3 text-text-inverse/80">Aug 15, 2025</p>
  </MediaCard.Content>
</MediaCard>
```

### Square Card

```tsx
<MediaCard orientation="square">
  <MediaCard.Image src="/images/album-art.jpg" alt="Album cover" />
  <MediaCard.Overlay />
  <MediaCard.Content>
    <h3 className="text-body-2 font-semibold text-text-inverse">Album Name</h3>
  </MediaCard.Content>
</MediaCard>
```

### With Badge

```tsx
import { Badge } from "@/web/components/ui/Badge";

<MediaCard orientation="portrait">
  <MediaCard.Image src="/images/show.jpg" alt="New release" />
  <MediaCard.Overlay />
  <MediaCard.Badge>
    <Badge variant="info">New</Badge>
  </MediaCard.Badge>
  <MediaCard.Content>
    <h3 className="text-body-2 font-semibold text-text-inverse">New Release</h3>
  </MediaCard.Content>
</MediaCard>
```

### With Action Overlay

```tsx
import { Play } from "lucide-react";

<MediaCard orientation="landscape">
  <MediaCard.Image src="/images/video-thumb.jpg" alt="Video thumbnail" />
  <MediaCard.Overlay />
  <MediaCard.Action>
    <button className="rounded-full bg-primary/80 p-r4 text-text-on-primary">
      <Play size={24} />
    </button>
  </MediaCard.Action>
  <MediaCard.Content>
    <h3 className="text-body-2 font-semibold text-text-inverse">Watch Trailer</h3>
  </MediaCard.Content>
</MediaCard>
```

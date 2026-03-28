# Swimlane

A titled content row designed to be stacked vertically for Netflix-style browse pages. Combines a header (title, subtitle, "View all" link) with a content body. Wraps itself in `ScrollReveal` for automatic entrance animation.

**Source:** `src/web/components/ui/Swimlane.tsx`
**Styles:** `src/web/style/components/swimlane.css`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `ReactNode` | **required** | Lane heading, rendered as an `<h2>`. |
| `subtitle` | `ReactNode` | -- | Optional secondary text below the title. |
| `viewAllHref` | `string` | -- | URL for a "View all" link in the header. |
| `animation` | `"fade-up" \| "fade-in" \| "fade-left" \| "fade-right" \| "scale"` | `"fade-up"` | Scroll-triggered entrance animation type. |
| `once` | `boolean` | `true` | Animate only on first scroll intersection. |
| `className` | `string` | -- | Additional CSS classes on the root `<section>`. |

## Styling

- The title uses `--H4` font size with `--Bold-Weight`.
- The subtitle uses `--BodyText-2` in `--C-TEXT-MUTED`.
- "View all" link uses `--C-ACCENT` with hover underline and `--C-ACCENT-HOVER` color shift.
- The whole lane has `margin-bottom: var(--R-SIZE-2)` for vertical stacking.
- Header has `padding-inline: var(--R-SIZE-5)` to align with carousel peek.

## Usage

### Netflix-Style Browse Row

```tsx
import { Swimlane } from "@/web/components/ui/Swimlane";
import { Carousel } from "@/web/components/ui/Carousel";
import { MediaCard } from "@/web/components/ui/MediaCard";

<Swimlane title="Trending Now" subtitle="Most popular this week" viewAllHref="/trending">
  <Carousel>
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
</Swimlane>
```

### Stacked Browse Page

```tsx
import { Stack } from "@/web/components/layout/Stack";

<Stack gap="r1">
  <Swimlane title="Continue Watching" viewAllHref="/continue">
    <Carousel>
      <Carousel.Track>
        {continueWatching.map((item) => (
          <Carousel.Item key={item.id}>
            <MediaCard orientation="landscape">
              <MediaCard.Image src={item.thumbnail} alt={item.title} />
              <MediaCard.Overlay />
              <MediaCard.Content>
                <h3 className="text-body-2 font-semibold text-text-inverse">
                  {item.title}
                </h3>
              </MediaCard.Content>
            </MediaCard>
          </Carousel.Item>
        ))}
      </Carousel.Track>
    </Carousel>
  </Swimlane>

  <Swimlane title="New Releases" viewAllHref="/new">
    <Carousel>
      <Carousel.Track>
        {newReleases.map((item) => (
          <Carousel.Item key={item.id}>
            <MediaCard orientation="portrait">
              <MediaCard.Image src={item.poster} alt={item.title} />
              <MediaCard.Overlay />
              <MediaCard.Content>
                <h3 className="text-body-2 font-semibold text-text-inverse">
                  {item.title}
                </h3>
              </MediaCard.Content>
            </MediaCard>
          </Carousel.Item>
        ))}
      </Carousel.Track>
    </Carousel>
  </Swimlane>
</Stack>
```

### Without "View All" Link

```tsx
<Swimlane title="Editor's Picks" animation="fade-in">
  <Carousel>
    <Carousel.Track>
      {picks.map((pick) => (
        <Carousel.Item key={pick.id}>
          <MediaCard orientation="square">
            <MediaCard.Image src={pick.image} alt={pick.name} />
            <MediaCard.Overlay />
            <MediaCard.Content>
              <h3 className="text-body-2 font-semibold text-text-inverse">
                {pick.name}
              </h3>
            </MediaCard.Content>
          </MediaCard>
        </Carousel.Item>
      ))}
    </Carousel.Track>
  </Carousel>
</Swimlane>
```

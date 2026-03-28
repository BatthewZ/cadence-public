# Hero

Full-width hero section with background image support, overlay scrim, and content slot. Built as a compound component with optional parallax and entrance animation.

**Source:** `src/web/components/ui/Hero.tsx`
**Styles:** `src/web/style/components/hero.css`

## Compound API

| Component         | Element     | Purpose                                                          |
| ----------------- | ----------- | ---------------------------------------------------------------- |
| `Hero`            | `<section>` | Root container. Controls size, alignment, and overlay.           |
| `Hero.Background` | `<div>`     | Absolutely-positioned background layer for images or colors.     |
| `Hero.Content`    | `<div>`     | Relative-positioned content slot with optional scroll animation. |

## Props

### Hero (root)

| Prop        | Type                             | Default | Description                                                                            |
| ----------- | -------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `size`      | `"sm" \| "md" \| "lg" \| "full"` | `"md"`  | Minimum height: `sm` = 40vh, `md` = 60vh, `lg` = 80vh, `full` = 100vh.                 |
| `overlay`   | `boolean`                        | `true`  | Renders a scrim overlay using `--OVERLAY-SCRIM-COLOR`.                                 |
| `align`     | `"start" \| "center" \| "end"`   | `"end"` | Vertical alignment of flex children: `start` = top, `center` = middle, `end` = bottom. |
| `className` | `string`                         | --      | Additional CSS classes on the `<section>`.                                             |

### Hero.Background

| Prop           | Type      | Default | Description                                                                       |
| -------------- | --------- | ------- | --------------------------------------------------------------------------------- |
| `src`          | `string`  | --      | Background image URL.                                                             |
| `alt`          | `string`  | --      | Alt text for the image. If omitted, the image is marked as `role="presentation"`. |
| `parallax`     | `boolean` | `false` | Enables parallax scroll effect on the background image (wraps in `<Parallax>`).   |
| `parallaxRate` | `number`  | --      | Custom parallax speed ratio (passed to `Parallax` component).                     |
| `className`    | `string`  | --      | Additional CSS classes on the background container.                               |

### Hero.Content

| Prop        | Type                                | Default     | Description                                                  |
| ----------- | ----------------------------------- | ----------- | ------------------------------------------------------------ |
| `animate`   | `boolean`                           | `false`     | Enables entrance animation using `ScrollReveal` + `Stagger`. |
| `animation` | `"fade-up" \| "fade-in" \| "scale"` | `"fade-up"` | Animation type when `animate` is `true`.                     |
| `className` | `string`                            | --          | Additional CSS classes on the content container.             |

## CSS Token Integration

| Token                             | Purpose                                                |
| --------------------------------- | ------------------------------------------------------ |
| `--OVERLAY-SCRIM-COLOR`           | Background color of the overlay when `overlay={true}`. |
| `--R-SIZE-1` through `--R-SIZE-3` | Responsive content padding (scales with breakpoints).  |

## Usage

### Image Hero

```tsx
import { Hero } from "@/web/components/ui/Hero";

<Hero size="lg">
  <Hero.Background src="/images/hero-bg.jpg" alt="Mountain landscape" />
  <Hero.Content>
    <h1 className="text-h1 font-bold text-text-inverse">Welcome</h1>
    <p className="text-body-1 text-text-inverse">Discover something extraordinary.</p>
  </Hero.Content>
</Hero>;
```

### Gradient Hero (No Image)

```tsx
<Hero size="md" overlay={false} className="bg-linear-to-br from-primary to-accent">
  <Hero.Content>
    <h1 className="text-h1 font-bold text-text-inverse">Build Fast</h1>
    <p className="text-body-1 text-text-inverse/80">Ship your next project in days, not months.</p>
  </Hero.Content>
</Hero>
```

### Hero with CTA Buttons

```tsx
<Hero size="full" align="center">
  <Hero.Background src="/images/hero-banner.jpg" parallax />
  <Hero.Content animate animation="fade-up">
    <h1 className="text-h1 font-bold text-text-inverse">The Future Starts Here</h1>
    <p className="text-body-1 text-text-inverse max-w-xl">
      A platform designed for builders, dreamers, and doers.
    </p>
    <div className="flex gap-r4 mt-r4">
      <button className="px-r2 py-r4 bg-primary text-text-on-primary rounded-md font-semibold">
        Get Started
      </button>
      <button className="px-r2 py-r4 bg-secondary text-text-primary rounded-md font-semibold">
        Learn More
      </button>
    </div>
  </Hero.Content>
</Hero>
```

### Small Hero with Top Alignment

```tsx
<Hero size="sm" align="start">
  <Hero.Background src="/images/page-header.jpg" />
  <Hero.Content>
    <h2 className="text-h3 font-bold text-text-inverse">About Us</h2>
  </Hero.Content>
</Hero>
```

### Parallax Background with Animated Content

```tsx
<Hero size="lg" align="end">
  <Hero.Background
    src="/images/cityscape.jpg"
    alt="City skyline at sunset"
    parallax
    parallaxRate={0.4}
  />
  <Hero.Content animate animation="fade-up">
    <h1 className="text-h1 font-bold text-text-inverse">Explore the City</h1>
    <p className="text-body-1 text-text-inverse">Events, dining, and nightlife curated for you.</p>
  </Hero.Content>
</Hero>
```

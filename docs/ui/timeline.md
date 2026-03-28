# Timeline

Vertical timeline with a connecting line, animated node dots, and alternating card layout on desktop. Built as a compound component with optional scroll-reveal animations.

**Source:** `src/web/components/ui/Timeline.tsx`
**Styles:** `src/web/style/components/timeline.css`

## Compound API

| Component       | Element | Purpose                                            |
| --------------- | ------- | -------------------------------------------------- |
| `Timeline`      | `<div>` | Root container. Manages item indexing and animation.|
| `Timeline.Item` | `<div>` | Individual timeline entry with node, card, and optional body content. |

## Props

### Timeline (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `animate` | `boolean` | `true` | Enables `ScrollReveal` entrance animation on items. |
| `className` | `string` | -- | Additional CSS classes on the root container. |

### Timeline.Item

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `date` | `string` | -- | Date or time label displayed above the title. |
| `title` | `string` | **required** | Title text rendered as an `<h3>`. |
| `icon` | `ReactNode` | -- | Custom node icon. Defaults to a styled dot if omitted. |
| `children` | `ReactNode` | -- | Body content rendered below the title inside the card. |
| `className` | `string` | -- | Additional CSS classes. |

## Layout

### Mobile (< 640px)

Single column with the connecting line on the left side. All cards appear to the right of the line.

- Line position: `var(--R-SIZE-5)` from the left.
- Content has left padding via `var(--R-SIZE-2)`.

### Desktop (>= 640px)

Alternating two-column layout with the connecting line centered:

- Odd items (1st, 3rd, 5th...): card on the left, right-aligned text.
- Even items (2nd, 4th, 6th...): card on the right.
- Node dots are centered on the line.
- Each card takes up `calc(50% - var(--R-SIZE-2))` width.

## CSS Token Integration

| Token | Purpose |
| --- | --- |
| `--C-BORDER-DEFAULT` | Color of the connecting vertical line. |
| `--C-ACCENT` | Color of the node dots. |
| `--C-SURFACE-0` | Node dot border color (creates cutout effect). |
| `--C-SURFACE-1` | Card background color. |
| `--RADIUS-LG` | Card border radius. |
| `--RADIUS-FULL` | Node dot border radius (circle). |

## Animation

When `animate` is `true`, each item enters via `ScrollReveal` with alternating direction:
- Even-indexed items (left side on desktop): `fade-right`
- Odd-indexed items (right side on desktop): `fade-left`

## Usage

### Basic Timeline

```tsx
import { Timeline } from "@/web/components/ui/Timeline";

<Timeline>
  <Timeline.Item date="January 2025" title="Project Kickoff">
    Initial planning and team assembly.
  </Timeline.Item>

  <Timeline.Item date="March 2025" title="Alpha Release">
    Core features launched to internal testers.
  </Timeline.Item>

  <Timeline.Item date="June 2025" title="Public Beta">
    Open beta with community feedback.
  </Timeline.Item>

  <Timeline.Item date="September 2025" title="General Availability">
    Production-ready release with full documentation.
  </Timeline.Item>
</Timeline>
```

### With Custom Icons

```tsx
import { Rocket, Code, Users, Flag } from "lucide-react";

<Timeline>
  <Timeline.Item
    date="Q1 2025"
    title="Launch"
    icon={<Rocket size={16} className="text-accent" />}
  >
    Initial release with core features.
  </Timeline.Item>

  <Timeline.Item
    date="Q2 2025"
    title="Build"
    icon={<Code size={16} className="text-accent" />}
  >
    API integrations and developer tools.
  </Timeline.Item>

  <Timeline.Item
    date="Q3 2025"
    title="Grow"
    icon={<Users size={16} className="text-accent" />}
  >
    Enterprise tier and team collaboration.
  </Timeline.Item>

  <Timeline.Item
    date="Q4 2025"
    title="Expand"
    icon={<Flag size={16} className="text-accent" />}
  >
    Marketplace and third-party integrations.
  </Timeline.Item>
</Timeline>
```

### Without Animation

```tsx
<Timeline animate={false}>
  <Timeline.Item date="2020" title="Founded">
    Company established in San Francisco.
  </Timeline.Item>

  <Timeline.Item date="2022" title="Series A">
    Raised $10M in funding.
  </Timeline.Item>

  <Timeline.Item date="2024" title="100K Users">
    Crossed the 100,000 user milestone.
  </Timeline.Item>
</Timeline>
```

### Minimal (No Date)

```tsx
<Timeline>
  <Timeline.Item title="Step 1: Sign Up">
    Create your account in under a minute.
  </Timeline.Item>

  <Timeline.Item title="Step 2: Configure">
    Set up your project with our guided wizard.
  </Timeline.Item>

  <Timeline.Item title="Step 3: Deploy">
    Ship to production with a single command.
  </Timeline.Item>
</Timeline>
```

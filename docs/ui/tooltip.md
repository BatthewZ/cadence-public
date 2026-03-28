# Tooltip

Hover/focus tooltip built on `@floating-ui/react`. Renders content in a portal with fade-in animation. Non-compound — wraps a single child element.

**Source:** `src/web/components/ui/Tooltip.tsx`
**Styles:** `src/web/style/components/tooltip.css`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `content` | `ReactNode` | **required** | The tooltip content to display. |
| `placement` | `Placement` | `"top"` | Where to position the tooltip relative to the child. |
| `delay` | `number` | `300` | Delay in ms before showing on hover. |
| `offset` | `number` | `8` | Distance in pixels between the child and tooltip. |
| `children` | `ReactElement` | **required** | The element that triggers the tooltip. Must accept a `ref`. |

## Behavior

- **Trigger:** appears on hover (with configurable delay) and focus; dismissed on pointer leave, blur, or Escape.
- **Positioning:** uses `useFloating` with `flip` and `shift` middleware for automatic repositioning.
- **Portal:** renders into `document.body` via `FloatingPortal` to escape overflow/z-index contexts.
- **Animation:** 150ms fade transition via `useTransitionStyles`.
- **Accessibility:** sets `aria-describedby` on the child linking to the tooltip `id`. Uses `role="tooltip"`.

## Styling

The `.tooltip` class applies:
- `--C-PRIMARY` background with `--C-TEXT-ON-PRIMARY` text color
- `--RADIUS-SM` border radius, `--SHADOW-SM` elevation
- `--BodyText-2` font size, `max-width: 280px`
- `z-index: 50` (above dropdowns/popovers at 40)
- `pointer-events: none` — tooltips cannot be interacted with

## Usage

### Basic

```tsx
import { Tooltip } from "@/web/components/ui/Tooltip";
import { Button } from "@/web/components/ui/Button";

<Tooltip content="Save your changes">
  <Button variant="primary">Save</Button>
</Tooltip>
```

### Custom Placement and Delay

```tsx
<Tooltip content="Edit profile settings" placement="right" delay={500}>
  <IconButton icon={<Settings />} aria-label="Settings" />
</Tooltip>
```

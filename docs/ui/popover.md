# Popover

Floating dialog panel built on `@floating-ui/react`. Uses a compound component pattern with click-to-toggle trigger, focus trapping, and portal rendering.

**Source:** `src/web/components/ui/Popover.tsx`
**Styles:** `src/web/style/components/popover.css`

## Compound API

| Component | Element | Purpose |
| --- | --- | --- |
| `Popover` | -- | Root provider. Manages open state and floating context. |
| `Popover.Trigger` | `<button>` | Clickable trigger that toggles the popover. |
| `Popover.Content` | `<div>` | Floating content panel rendered in a portal. |

## Props

### Popover (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `open` | `boolean` | -- | Controlled open state. |
| `onOpenChange` | `(open: boolean) => void` | -- | Callback when open state should change. |
| `defaultOpen` | `boolean` | `false` | Initial open state (uncontrolled). |
| `placement` | `Placement` | `"bottom"` | Where to position the content relative to the trigger. |
| `offset` | `number` | `8` | Distance in pixels between trigger and content. |

### Popover.Trigger

Accepts all `<button>` props. Sets `aria-expanded`, `aria-haspopup="dialog"`, and `aria-controls` automatically.

### Popover.Content

Accepts all `<div>` props. Additional `className` and `style` are merged with the floating styles.

## Behavior

- **Open/close:** click-to-toggle via `useClick`. Dismissed on outside click or Escape via `useDismiss`.
- **Role:** `dialog` — announced as a dialog by screen readers.
- **Focus management:** `FloatingFocusManager` traps focus within the content and restores focus to the trigger on close.
- **Portal:** renders into `document.body` via `FloatingPortal`.
- **Animation:** 150ms scale(0.95) + fade transition via `useTransitionStyles`.
- **ARIA:** trigger has `aria-expanded`, `aria-haspopup="dialog"`, and `aria-controls` linking to the content `id`.

## Styling

The `.popover-content` class applies:
- `--C-SURFACE-0` background, `--C-BORDER-DEFAULT` border
- `--RADIUS-MD` border radius, `--SHADOW-LG` elevation
- `--R-SIZE-3` padding
- `z-index: 40`

## Usage

### Basic

```tsx
import { Popover } from "@/web/components/ui/Popover";
import { Button } from "@/web/components/ui/Button";
import { Stack } from "@/web/components/layout/Stack";
import { Text } from "@/web/components/ui/Text";

<Popover>
  <Popover.Trigger>
    <Button variant="secondary">More info</Button>
  </Popover.Trigger>
  <Popover.Content>
    <Stack gap="r5">
      <Text variant="body-1" className="font-semibold">Details</Text>
      <Text variant="body-2" color="secondary">
        Additional context shown inside the popover panel.
      </Text>
    </Stack>
  </Popover.Content>
</Popover>
```

### Controlled

```tsx
import { useState } from "react";
import { Popover } from "@/web/components/ui/Popover";

function ControlledPopover() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen} placement="right">
      <Popover.Trigger>
        <button>Toggle</button>
      </Popover.Trigger>
      <Popover.Content>
        <p>Controlled content.</p>
        <button onClick={() => setOpen(false)}>Close</button>
      </Popover.Content>
    </Popover>
  );
}
```

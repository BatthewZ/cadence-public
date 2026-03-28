# DropdownMenu

Floating dropdown menu built on `@floating-ui/react` with full keyboard navigation, typeahead search, and ARIA menu pattern. Uses a compound component pattern.

**Source:** `src/web/components/ui/DropdownMenu.tsx`
**Styles:** `src/web/style/components/dropdown-menu.css`

## Compound API

| Component | Element | Purpose |
| --- | --- | --- |
| `DropdownMenu` | -- | Root provider. Manages open state, list navigation, and floating context. |
| `DropdownMenu.Trigger` | `<button>` | Clickable trigger that toggles the menu. |
| `DropdownMenu.Content` | `<div>` | Floating menu container rendered in a portal. |
| `DropdownMenu.Item` | `<button>` | Individual menu item with optional icon. |
| `DropdownMenu.Divider` | `<hr>` | Visual separator between groups of items. |
| `DropdownMenu.Label` | `<span>` | Non-interactive section label. |
| `DropdownMenu.Sub` | -- | Sub-menu container. Manages hover-based open/close with `safePolygon`. |
| `DropdownMenu.SubTrigger` | `<button>` | Item that opens a flyout sub-menu on hover. Shows a chevron indicator. |
| `DropdownMenu.SubContent` | `<div>` | Flyout panel positioned beside the SubTrigger. Rendered in a portal. |
| `DropdownMenu.SubItem` | `<button>` | Menu item inside a SubContent with independent keyboard navigation. |

## Props

### DropdownMenu (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `open` | `boolean` | -- | Controlled open state. |
| `onOpenChange` | `(open: boolean) => void` | -- | Callback when open state should change. |
| `defaultOpen` | `boolean` | `false` | Initial open state (uncontrolled). |
| `placement` | `Placement` | `"bottom-start"` | Where to position the menu relative to the trigger. |

### DropdownMenu.Trigger

Accepts all `<button>` props. Sets `aria-expanded`, `aria-haspopup="menu"`, and `aria-controls` automatically.

### DropdownMenu.Content

Accepts all `<div>` props. Additional `className` and `style` are merged with the floating styles.

### DropdownMenu.Item

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `index` | `number` | **required** | Position in the menu item list (used for keyboard navigation). |
| `icon` | `ReactNode` | -- | Optional icon rendered before the label. |
| `disabled` | `boolean` | `false` | Disables the item (muted text, no interaction). |
| `variant` | `"default" \| "danger"` | `"default"` | Visual variant. Use `"danger"` for destructive actions (delete, remove, revoke). |
| `onSelect` | `() => void` | -- | Callback when the item is selected. Menu closes automatically. |

### DropdownMenu.Divider

Accepts all `<hr>` props. Renders `role="separator"`.

### DropdownMenu.Label

Accepts all `<span>` props. Renders `role="presentation"`.

### DropdownMenu.Sub

No props other than `children`. Wraps a SubTrigger + SubContent pair.

### DropdownMenu.SubTrigger

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `icon` | `ReactNode` | -- | Optional icon rendered before the label. |

Accepts all `<button>` props. Renders a `ChevronRight` indicator on the right side. Sets `aria-haspopup="menu"` and `aria-expanded`.

### DropdownMenu.SubContent

Accepts all `<div>` props. Styled identically to `Content` but positioned relative to the SubTrigger (`right-start` placement).

### DropdownMenu.SubItem

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `index` | `number` | **required** | Position in the sub-menu item list (independent from root menu indices). |
| `icon` | `ReactNode` | -- | Optional icon rendered before the label. |
| `disabled` | `boolean` | `false` | Disables the item. |
| `variant` | `"default" \| "danger"` | `"default"` | Visual variant. Use `"danger"` for destructive actions. |
| `onSelect` | `() => void` | -- | Callback when selected. Closes both the sub-menu and root menu. |

## Behavior

- **Open/close:** click-to-toggle via `useClick`. Dismissed on outside click or Escape via `useDismiss`.
- **Role:** `menu` with `menuitem` roles on items.
- **Keyboard navigation:** Arrow keys move focus between items via `useListNavigation` (loops). Home/End jump to first/last.
- **Typeahead:** typing characters focuses the matching item via `useTypeahead`.
- **Initial focus:** set to `-1` (no item focused on open — user must arrow into the list).
- **Focus management:** `FloatingFocusManager` manages focus trap and restoration.
- **Portal:** renders into `document.body` via `FloatingPortal`.
- **Animation:** 150ms scale(0.95) + fade transition via `useTransitionStyles`.
- **ARIA:** trigger has `aria-expanded`, `aria-haspopup="menu"`, and `aria-controls` linking to the menu `id`. Items use `aria-disabled` for disabled state.
- **Sub-menus:** open on hover with a 75ms open / 150ms close delay. `safePolygon` keeps the flyout open while the pointer travels between the trigger and the sub-content. Sub-menus have their own independent `useListNavigation` and `useTypeahead` so keyboard navigation works correctly within each level.

## Styling

### Content (`.dropdown-menu-content`)
- `--C-SURFACE-0` background, `--C-BORDER-DEFAULT` border
- `--RADIUS-MD` border radius, `--SHADOW-LG` elevation
- `min-width: 180px`, `z-index: 40`

### Item (`.dropdown-menu-item`)
- Full-width flex layout with `--R-SIZE-2` gap
- `--BodyText-1` font size, `--C-TEXT-PRIMARY` color
- Hover/focus: `--C-SURFACE-1` background
- Disabled: `--C-TEXT-MUTED` color, `default` cursor

### Danger variant (`.dropdown-menu-item--danger`)
- `--C-STATUS-ERROR` text and icon color
- Hover/focus: `--C-STATUS-ERROR-BG` background

### Icon (`.dropdown-menu-item-icon`)
- 16px square, `--C-TEXT-SECONDARY` color

### Divider (`.dropdown-menu-divider`)
- 1px `--C-BORDER-DEFAULT` line

### Label (`.dropdown-menu-label`)
- `--BodyText-2` size, `--C-TEXT-MUTED` color, 600 weight

### SubTrigger open state (`.dropdown-menu-sub-trigger--open`)
- `--C-SURFACE-1` background to keep the trigger highlighted while its flyout is visible

## Usage

### Basic

```tsx
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { Button } from "@/web/components/ui/Button";
import { Edit, Trash2, Copy } from "lucide-react";

<DropdownMenu>
  <DropdownMenu.Trigger>
    <Button variant="secondary">Actions</Button>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content>
    <DropdownMenu.Item index={0} icon={<Edit />} onSelect={() => edit()}>
      Edit
    </DropdownMenu.Item>
    <DropdownMenu.Item index={1} icon={<Copy />} onSelect={() => duplicate()}>
      Duplicate
    </DropdownMenu.Item>
    <DropdownMenu.Divider />
    <DropdownMenu.Item index={2} variant="danger" icon={<Trash2 />} onSelect={() => remove()}>
      Delete
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu>
```

### With Labels and Disabled Items

```tsx
<DropdownMenu>
  <DropdownMenu.Trigger>
    <Button variant="ghost">Options</Button>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content>
    <DropdownMenu.Label>Account</DropdownMenu.Label>
    <DropdownMenu.Item index={0} onSelect={() => openProfile()}>
      Profile
    </DropdownMenu.Item>
    <DropdownMenu.Item index={1} onSelect={() => openSettings()}>
      Settings
    </DropdownMenu.Item>
    <DropdownMenu.Divider />
    <DropdownMenu.Label>Danger Zone</DropdownMenu.Label>
    <DropdownMenu.Item index={2} disabled>
      Transfer Ownership
    </DropdownMenu.Item>
    <DropdownMenu.Item index={3} onSelect={() => deleteAccount()}>
      Delete Account
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu>
```

### With Sub-menus

```tsx
<DropdownMenu>
  <DropdownMenu.Trigger>
    <IconButton variant="ghost" size="sm"><MoreHorizontal size={14} /></IconButton>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content>
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger icon={<Flag size={14} />}>
        Priority
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent>
        <DropdownMenu.SubItem index={0} onSelect={() => setPriority("high")}>High</DropdownMenu.SubItem>
        <DropdownMenu.SubItem index={1} onSelect={() => setPriority("medium")}>Medium</DropdownMenu.SubItem>
        <DropdownMenu.SubItem index={2} onSelect={() => setPriority("low")}>Low</DropdownMenu.SubItem>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
    <DropdownMenu.Divider />
    <DropdownMenu.Item index={0} onSelect={() => remove()}>Delete</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu>
```

### Controlled

```tsx
import { useState } from "react";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";

function ControlledMenu() {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger>
        <button>Menu</button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item index={0} onSelect={() => console.log("selected")}>
          Action
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
```

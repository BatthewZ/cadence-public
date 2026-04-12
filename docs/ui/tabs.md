# Tabs

Animated tab bar with a sliding active indicator and panel crossfade. Built as a compound component with full keyboard navigation and ARIA support.

**Source:** `src/web/components/ui/Tabs.tsx`
**Styles:** `src/web/style/components/tabs.css`

## Compound API

| Component     | Element    | Purpose                              |
| ------------- | ---------- | ------------------------------------ |
| `Tabs`        | `<div>`    | Root provider. Manages active state. |
| `Tabs.List`   | `<div>`    | Tab bar container with `role="tablist"` and sliding indicator. |
| `Tabs.Tab`    | `<button>` | Individual tab trigger with `role="tab"`. |
| `Tabs.Panel`  | `<div>`    | Content panel with `role="tabpanel"`. Mounts/unmounts with fade animation. |

## Props

### Tabs (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `defaultValue` | `string` | **required** | Initially active tab key (uncontrolled). |
| `value` | `string` | -- | Active tab key (controlled mode). |
| `onValueChange` | `(value: string) => void` | -- | Callback when active tab changes. |
| `variant` | `"underline" \| "pill" \| "enclosed"` | `"underline"` | Visual style of the tab bar and indicator. |
| `className` | `string` | -- | Additional CSS classes on root `<div>`. |

### Tabs.List

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes on the tab bar. |

### Tabs.Tab

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | **required** | Unique key linking the tab to its panel. |
| `disabled` | `boolean` | `false` | Disables the tab. |
| `className` | `string` | -- | Additional CSS classes on the tab button. |

### Tabs.Panel

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | **required** | Key matching the corresponding `Tabs.Tab`. |
| `className` | `string` | -- | Additional CSS classes on the panel. |

## Variants

### Underline (default)

A bottom border on the list with a 2px accent-colored sliding indicator.

### Pill

A rounded pill-shaped accent background slides behind the active tab. Selected tab text inverts to `--C-TEXT-ON-ACCENT`.

### Enclosed

Browser-tab style. The active tab gets a solid background, border on three sides, and the bottom border disappears to merge with the panel below.

## Scroll Overflow

When the tab list overflows its container, the scrollable edges fade to transparent to signal that more tabs are available. This uses `mask-image` rather than a color overlay, so the fade works against any background — the tabs don't need to sit on a specific surface color.

The `.tabs-list` element carries `data-scroll-left` and `data-scroll-right` attributes reflecting whether each edge can scroll; CSS selectors apply the appropriate mask gradient. The attributes update on scroll and resize.

## Keyboard Navigation

| Key | Behavior |
| --- | --- |
| `ArrowRight` | Move focus to the next tab (wraps). |
| `ArrowLeft` | Move focus to the previous tab (wraps). |
| `Home` | Move focus to the first tab. |
| `End` | Move focus to the last tab. |

Tabs auto-activate on focus (WAI-ARIA recommended pattern). Disabled tabs are skipped.

## Accessibility

- `role="tablist"` on `Tabs.List`, `role="tab"` on each `Tabs.Tab`, `role="tabpanel"` on each `Tabs.Panel`.
- `aria-selected`, `aria-controls`, and `aria-labelledby` link tabs to panels.
- Focus ring via `:focus-visible` outline.
- `prefers-reduced-motion: reduce` disables the indicator slide transition and panel crossfade.

## Usage

### Basic (Underline)

```tsx
import { Tabs } from "@/web/components/ui/Tabs";

<Tabs defaultValue="overview">
  <Tabs.List>
    <Tabs.Tab value="overview">Overview</Tabs.Tab>
    <Tabs.Tab value="analytics">Analytics</Tabs.Tab>
    <Tabs.Tab value="settings">Settings</Tabs.Tab>
  </Tabs.List>

  <Tabs.Panel value="overview">Overview content here.</Tabs.Panel>
  <Tabs.Panel value="analytics">Analytics content here.</Tabs.Panel>
  <Tabs.Panel value="settings">Settings content here.</Tabs.Panel>
</Tabs>
```

### Pill Variant

```tsx
<Tabs defaultValue="all" variant="pill">
  <Tabs.List>
    <Tabs.Tab value="all">All</Tabs.Tab>
    <Tabs.Tab value="active">Active</Tabs.Tab>
    <Tabs.Tab value="archived">Archived</Tabs.Tab>
  </Tabs.List>

  <Tabs.Panel value="all">All items.</Tabs.Panel>
  <Tabs.Panel value="active">Active items.</Tabs.Panel>
  <Tabs.Panel value="archived">Archived items.</Tabs.Panel>
</Tabs>
```

### Enclosed Variant

```tsx
<Tabs defaultValue="code" variant="enclosed">
  <Tabs.List>
    <Tabs.Tab value="code">Code</Tabs.Tab>
    <Tabs.Tab value="preview">Preview</Tabs.Tab>
    <Tabs.Tab value="tests">Tests</Tabs.Tab>
  </Tabs.List>

  <Tabs.Panel value="code">Code editor panel.</Tabs.Panel>
  <Tabs.Panel value="preview">Live preview panel.</Tabs.Panel>
  <Tabs.Panel value="tests">Test results panel.</Tabs.Panel>
</Tabs>
```

### Controlled Usage

```tsx
import { useState } from "react";
import { Tabs } from "@/web/components/ui/Tabs";

function ControlledTabs() {
  const [activeTab, setActiveTab] = useState("tab1");

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} defaultValue="tab1">
      <Tabs.List>
        <Tabs.Tab value="tab1">Tab 1</Tabs.Tab>
        <Tabs.Tab value="tab2">Tab 2</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="tab1">Panel 1</Tabs.Panel>
      <Tabs.Panel value="tab2">Panel 2</Tabs.Panel>
    </Tabs>
  );
}
```

### With Disabled Tab

```tsx
<Tabs defaultValue="general">
  <Tabs.List>
    <Tabs.Tab value="general">General</Tabs.Tab>
    <Tabs.Tab value="billing" disabled>Billing</Tabs.Tab>
    <Tabs.Tab value="team">Team</Tabs.Tab>
  </Tabs.List>

  <Tabs.Panel value="general">General settings.</Tabs.Panel>
  <Tabs.Panel value="billing">Billing details.</Tabs.Panel>
  <Tabs.Panel value="team">Team management.</Tabs.Panel>
</Tabs>
```

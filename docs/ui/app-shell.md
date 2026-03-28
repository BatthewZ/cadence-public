# AppShell

A responsive application shell with a sticky navbar, collapsible sidebar, and main content area. Renders as a CSS Grid layout with mobile-first responsiveness: on mobile, the sidebar becomes a portal-based drawer overlay; on desktop, it sits inline and can collapse to icon-only width.

Built as a compound component — all sub-components must be used within `<AppShell>`.

**Source:** `src/web/components/ui/AppShell.tsx`
**Styles:** `src/web/style/components/app-shell.css`

---

## Hooks

| Hook | Returns | Description |
| --- | --- | --- |
| `useAppShell()` | `AppShellContextValue` | Returns the AppShell context. Throws if used outside an `<AppShell>` provider. |
| `useOptionalAppShell()` | `AppShellContextValue \| null` | Returns the AppShell context if available, or `null` when rendered outside an `<AppShell>` provider. Useful for components (e.g. `UserMenu`) that adapt behavior based on whether they're inside a shell layout. |

---

## Sub-Components

| Component              | Element    | Description                                           |
| ---------------------- | ---------- | ----------------------------------------------------- |
| `AppShell`             | `<div>`    | Root — provides context and CSS Grid container        |
| `AppShell.Navbar`      | `<header>` | Sticky top bar spanning full width                    |
| `AppShell.Brand`       | `<div>`    | Logo/title slot inside the navbar                     |
| `AppShell.NavbarActions` | `<div>`  | Right-aligned actions slot in the navbar              |
| `AppShell.Toggle`      | `<button>` | Opens/closes sidebar (mobile) or collapses it (desktop) |
| `AppShell.Sidebar`     | `<aside>`  | Navigation sidebar with mobile drawer support         |
| `AppShell.SidebarSection` | `<div>` | Group within sidebar, optional title                  |
| `AppShell.SidebarLink` | `<Link>`   | Navigation link with icon, active state, and tooltip when collapsed |
| `AppShell.Main`        | `<div>`    | Main content area                                     |

---

## Root Props

| Prop                 | Type                        | Default | Description                             |
| -------------------- | --------------------------- | ------- | --------------------------------------- |
| `defaultOpen`        | `boolean`                   | `false` | Initial open state (uncontrolled)       |
| `open`               | `boolean`                   | --      | Controlled open state                   |
| `onOpenChange`       | `(open: boolean) => void`   | --      | Callback when open state changes        |
| `defaultCollapsed`   | `boolean`                   | `false` | Initial collapsed state (uncontrolled)  |
| `collapsed`          | `boolean`                   | --      | Controlled collapsed state              |
| `onCollapsedChange`  | `(collapsed: boolean) => void` | --   | Callback when collapsed state changes   |
| `className`          | `string`                    | --      | Additional CSS classes                  |
| `children`           | `ReactNode`                 | --      | Sub-components                          |

Also accepts all `div` props.

### Open vs Collapsed

- **Open/closed** controls the mobile drawer visibility (toggled by `AppShell.Toggle` on mobile).
- **Collapsed/expanded** controls the desktop sidebar width: expanded = 260px, collapsed = 64px (icon-only). `AppShell.Toggle` on desktop toggles this.

---

## SidebarSection Props

| Prop    | Type     | Default | Description                                   |
| ------- | -------- | ------- | --------------------------------------------- |
| `title` | `string` | --      | Optional uppercase section header (hidden when collapsed) |

Also accepts all `div` props.

---

## SidebarLink Props

| Prop       | Type         | Default | Description                                    |
| ---------- | ------------ | ------- | ---------------------------------------------- |
| `to`       | `string`     | --      | Route path                                     |
| `icon`     | `LucideIcon` | --      | Lucide icon component (optional)               |
| `end`      | `boolean`    | --      | When `true`, only matches exactly at `to` (no prefix matching) |
| `label`    | `string`     | --      | Explicit accessible label. Falls back to `children` when it is a plain string. Ensures the link always has an accessible name even when the sidebar is collapsed and the visible label is hidden. |
| `children` | `ReactNode`  | --      | Link label (hidden when collapsed; shown as tooltip) |

Also accepts all `a` props (except `href`).

Active state is determined automatically by matching the current pathname against `to`.

---

## Behavior

### Mobile (< 640px)

- Desktop sidebar is hidden via `display: none`.
- `AppShell.Toggle` opens the sidebar as a fixed-position drawer rendered through a `Portal`.
- A scrim overlay appears behind the drawer.
- Sidebar closes on: click outside, Escape key, or route navigation.
- Focus is trapped within the open drawer (`useFocusTrap`).

### Desktop (>= 640px)

- Sidebar renders inline in the CSS Grid.
- `AppShell.Toggle` toggles between expanded (260px) and collapsed (64px).
- When collapsed, link labels are hidden and icons get a `Tooltip` on hover.
- Section titles are hidden when collapsed.

### Accessibility

- Toggle button has `aria-expanded` and `aria-controls` pointing to the sidebar ID.
- Toggle label changes contextually: "Open/Close navigation" (mobile), "Expand/Collapse sidebar" (desktop).
- Sidebar has `role="navigation"` and `aria-label="Main navigation"`.
- Mobile drawer has `aria-modal="true"`.
- Active sidebar link has `aria-current="page"`.
- Sidebar links derive `aria-label` from the explicit `label` prop or `children` (when a plain string), ensuring collapsed links retain an accessible name.

### Reduced Motion

Sidebar width transition and mobile drawer animations are disabled when `prefers-reduced-motion: reduce` is active.

---

## CSS Architecture

The component uses plain CSS classes (no Tailwind) in `app-shell.css`:

| Class                             | Purpose                                |
| --------------------------------- | -------------------------------------- |
| `.app-shell`                      | CSS Grid root (`auto 1fr` rows/cols)   |
| `.app-shell-navbar`               | Sticky full-width header               |
| `.app-shell-brand`                | Brand/logo container                   |
| `.app-shell-navbar-actions`       | Right-aligned navbar actions           |
| `.app-shell-toggle`               | Hamburger / collapse button            |
| `.app-shell-sidebar`              | Desktop inline sidebar                 |
| `.app-shell-sidebar[data-collapsed]` | Collapsed sidebar (64px)            |
| `.app-shell-sidebar-section`      | Grouped section within sidebar         |
| `.app-shell-sidebar-section-title`| Uppercase section heading              |
| `.app-shell-sidebar-link`         | Navigation link row                    |
| `.app-shell-sidebar-link[data-active]` | Active link highlight             |
| `.app-shell-sidebar-mobile`       | Mobile drawer (portal-rendered)        |
| `.app-shell-scrim`                | Mobile backdrop overlay                |
| `.app-shell-main`                 | Main content area                      |

Design system tokens used: `--C-SURFACE-*`, `--C-BORDER-*`, `--C-TEXT-*`, `--C-ACCENT`, `--MOTION-*`, `--OVERLAY-SCRIM-COLOR`, `--SHADOW-LG`.

---

## Usage

### Basic Shell

```tsx
import { AppShell } from "@/web/components/ui/AppShell";
import { Home, Settings } from "lucide-react";

<AppShell defaultOpen>
  <AppShell.Navbar>
    <AppShell.Toggle />
    <AppShell.Brand>
      <Text variant="h6">My App</Text>
    </AppShell.Brand>
    <AppShell.NavbarActions>
      <Button variant="ghost" size="sm">Sign Out</Button>
    </AppShell.NavbarActions>
  </AppShell.Navbar>

  <AppShell.Sidebar>
    <AppShell.SidebarSection>
      <AppShell.SidebarLink to="/dashboard" icon={Home}>
        Dashboard
      </AppShell.SidebarLink>
      <AppShell.SidebarLink to="/settings" icon={Settings}>
        Settings
      </AppShell.SidebarLink>
    </AppShell.SidebarSection>
  </AppShell.Sidebar>

  <AppShell.Main>
    <Container size="lg">
      <p>Page content here.</p>
    </Container>
  </AppShell.Main>
</AppShell>
```

### With AuthenticatedLayout

For authenticated pages, prefer the [`AuthenticatedLayout`](layout.md#authenticatedlayout) wrapper which pre-configures the AppShell with sign-out, navigation links, and user info:

```tsx
import { AuthenticatedLayout } from "@/web/components/layout";

function Dashboard() {
  return (
    <AuthenticatedLayout>
      <Container size="lg">
        <p>Dashboard content</p>
      </Container>
    </AuthenticatedLayout>
  );
}
```

---

## Dependencies

- [`Portal`](portal.md) — mobile drawer rendering
- [`Tooltip`](tooltip.md) — collapsed sidebar link labels
- [`useClickOutside`](hooks.md#useclickoutside) — close mobile drawer on outside click
- [`useFocusTrap`](hooks.md#usefocustrap) — trap focus in mobile drawer
- `lucide-react` — `Menu`, `PanelLeft`, `PanelLeftClose` icons for toggle

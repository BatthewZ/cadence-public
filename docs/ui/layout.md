# Layout Components

Layout primitives for composing page structure. These are thin wrappers around flex utilities that provide a consistent API with responsive spacing tokens.

All layout components accept `className` for overrides (merged via `cn()`), use `forwardRef`, and spread remaining props onto the root element.

---

## Stack

Vertical flex container with a responsive gap.

**Source:** `src/web/components/layout/Stack.tsx`

### Props

| Prop        | Type                                       | Default | Description                                    |
| ----------- | ------------------------------------------ | ------- | ---------------------------------------------- |
| `gap`       | `"r1" \| "r2" \| "r3" \| "r4" \| "r5" \| "r6"` | `"r4"`  | Responsive gap between children                |
| `as`        | `ElementType`                              | `"div"` | Polymorphic element type                       |
| `className` | `string`                                   | --      | Additional CSS classes                         |
| `children`  | `ReactNode`                                | --      | Content                                        |

Also accepts all props of the underlying element type.

### Base Classes

```
flex flex-col gap-r4
```

### Usage

```tsx
import { Stack } from "@/web/components/layout/Stack";

{/* Default gap (r4) */}
<Stack>
  <h2>Title</h2>
  <p>Description paragraph.</p>
  <p>Another paragraph.</p>
</Stack>

{/* Large gap for section spacing */}
<Stack gap="r1">
  <section>Hero</section>
  <section>Features</section>
  <section>Footer</section>
</Stack>

{/* Tight gap for compact content */}
<Stack gap="r6">
  <span>Label</span>
  <span>Helper text</span>
</Stack>

{/* Render as a semantic element */}
<Stack as="section" gap="r3">
  <h3>Section heading</h3>
  <p>Section content.</p>
</Stack>
```

---

## Row

Horizontal flex container with responsive gap, alignment, and wrapping.

**Source:** `src/web/components/layout/Row.tsx`

### Props

| Prop        | Type                                                         | Default    | Description                        |
| ----------- | ------------------------------------------------------------ | ---------- | ---------------------------------- |
| `gap`       | `"r1" \| "r2" \| "r3" \| "r4" \| "r5" \| "r6"`                  | `"r5"`     | Responsive gap between children    |
| `align`     | `"start" \| "center" \| "end" \| "stretch" \| "baseline"`        | `"center"` | Cross-axis alignment (`items-*`)   |
| `justify`   | `"start" \| "center" \| "end" \| "between" \| "around" \| "evenly"` | `"start"`  | Main-axis alignment (`justify-*`)  |
| `wrap`      | `boolean`                                                    | `false`    | Enable `flex-wrap`                 |
| `as`        | `ElementType`                                                | `"div"`    | Polymorphic element type           |
| `className` | `string`                                                     | --         | Additional CSS classes             |
| `children`  | `ReactNode`                                                  | --         | Content                            |

Also accepts all props of the underlying element type.

### Base Classes

```
flex flex-row items-center justify-start gap-r5
```

### Usage

```tsx
import { Row } from "@/web/components/layout/Row";

{/* Default: centered items, start-justified */}
<Row>
  <span>Left</span>
  <span>Right</span>
</Row>

{/* Space-between for a toolbar */}
<Row justify="between">
  <span>Logo</span>
  <nav>Links</nav>
</Row>

{/* Wrapping tag list */}
<Row gap="r6" wrap>
  <span>Tag 1</span>
  <span>Tag 2</span>
  <span>Tag 3</span>
  <span>Tag 4</span>
</Row>

{/* Stretch children to equal height */}
<Row align="stretch" gap="r3">
  <div>Card A</div>
  <div>Card B (taller)</div>
</Row>
```

---

## Center

Centers children on both axes using flexbox.

**Source:** `src/web/components/layout/Center.tsx`

### Props

| Prop        | Type        | Default | Description            |
| ----------- | ----------- | ------- | ---------------------- |
| `className` | `string`    | --      | Additional CSS classes |
| `children`  | `ReactNode` | --      | Content                |

Also accepts all `div` props.

### Base Classes

```
flex items-center justify-center
```

### Usage

```tsx
import { Center } from "@/web/components/layout/Center";

{/* Center a loading spinner in the viewport */}
<Center className="min-h-screen">
  <Spinner />
</Center>

{/* Center an icon inside a fixed-size box */}
<Center className="size-12 rounded-full bg-surface-2">
  <Icon />
</Center>
```

---

## Container

Max-width wrapper with responsive horizontal padding. Centers itself with `mx-auto`.

**Source:** `src/web/components/layout/Container.tsx`

### Props

| Prop        | Type                                           | Default | Description                    |
| ----------- | ---------------------------------------------- | ------- | ------------------------------ |
| `size`      | `"sm" \| "md" \| "lg" \| "xl" \| "full"`           | `"md"`  | Max-width constraint           |
| `className` | `string`                                       | --      | Additional CSS classes         |
| `children`  | `ReactNode`                                    | --      | Content                        |

Also accepts all `div` props.

### Size Map

| Size   | Max Width  |
| ------ | ---------- |
| `sm`   | 30rem      |
| `md`   | 40rem      |
| `lg`   | 48rem      |
| `xl`   | 64rem      |
| `full` | 100%       |

### Base Classes

```
mx-auto w-full px-r3 max-w-[40rem]
```

### Usage

```tsx
import { Container } from "@/web/components/layout/Container";

{/* Default medium container */}
<Container>
  <p>Content constrained to 40rem.</p>
</Container>

{/* Narrow container for auth forms */}
<Container size="sm">
  <form>...</form>
</Container>

{/* Wide container for dashboards */}
<Container size="xl">
  <div>Dashboard grid</div>
</Container>

{/* Full-width with padding */}
<Container size="full">
  <div>Edge-to-edge (with horizontal padding)</div>
</Container>
```

---

## Spacer

A flex spacer that expands to fill available space. Useful for pushing items apart inside a `Row` or `Stack`.

**Source:** `src/web/components/layout/Spacer.tsx`

### Props

| Prop        | Type     | Default | Description            |
| ----------- | -------- | ------- | ---------------------- |
| `className` | `string` | --      | Additional CSS classes |

Also accepts all `div` props.

### Base Classes

```
flex-1
```

### Usage

```tsx
import { Spacer } from "@/web/components/layout/Spacer";

{/* Push a button to the right end of a row */}
<Row>
  <span>App Title</span>
  <Spacer />
  <button>Sign Out</button>
</Row>
```

---

## Divider

Horizontal or vertical separator line.

**Source:** `src/web/components/layout/Divider.tsx`

### Props

| Prop          | Type                            | Default        | Description            |
| ------------- | ------------------------------- | -------------- | ---------------------- |
| `orientation` | `"horizontal" \| "vertical"`    | `"horizontal"` | Direction of the rule  |
| `className`   | `string`                        | --             | Additional CSS classes |

Also accepts all `hr` props (horizontal) or `div` props (vertical).

### Rendering Behavior

- **Horizontal:** Renders an `<hr>` element with `border-t border-border-default`.
- **Vertical:** Renders a `<div>` element with `role="separator"`, `aria-orientation="vertical"`, and `border-l border-border-default self-stretch`.

### Usage

```tsx
import { Divider } from "@/web/components/layout/Divider";

{/* Horizontal divider between sections */}
<Stack>
  <p>Above the line</p>
  <Divider />
  <p>Below the line</p>
</Stack>

{/* Vertical divider between items in a row */}
<Row align="stretch">
  <span>Left</span>
  <Divider orientation="vertical" />
  <span>Right</span>
</Row>
```

---

## AuthenticatedLayout

A pre-configured [`AppShell`](app-shell.md) layout for authenticated pages. Provides a navbar with branding, notification bell, and user menu, plus a sidebar with navigation links and user info.

**Source:** `src/web/components/layout/AuthenticatedLayout.tsx`

### Props

| Prop       | Type        | Default | Description   |
| ---------- | ----------- | ------- | ------------- |
| `children` | `ReactNode` | --      | Page content  |

### Included Features

- **Navbar:** App brand, `NotificationBell`, user menu
- **Sidebar:** Links to `/dashboard` and `/settings` with Lucide icons, user name/email display
- Uses `useSession()` for user data and `signOut()` for authentication

### Usage

All authenticated pages should use this layout instead of building their own navbar/header:

```tsx
import { AuthenticatedLayout, Container, Stack } from "@/web/components/layout";

function Dashboard() {
  return (
    <AuthenticatedLayout>
      <Container size="lg">
        <Stack gap="r3" className="py-r2">
          <Text variant="h3">Dashboard</Text>
          {/* Page content */}
        </Stack>
      </Container>
    </AuthenticatedLayout>
  );
}
```

---

## Composition Examples

### Page Layout with AppShell

For authenticated pages, use [`AuthenticatedLayout`](#authenticatedlayout) which wraps the [`AppShell`](app-shell.md) with navigation and auth controls. Page content goes inside as children:

```tsx
import { AuthenticatedLayout, Container, Stack } from "@/web/components/layout";
import { Text } from "@/web/components/ui";

function SettingsPage() {
  return (
    <AuthenticatedLayout>
      <Container size="lg">
        <Stack gap="r3" className="py-r2">
          <Text variant="h3">Settings</Text>
          {/* Settings sections */}
        </Stack>
      </Container>
    </AuthenticatedLayout>
  );
}
```

### Public Page Layout

For public (non-authenticated) pages, compose layout primitives directly:

```tsx
import { Stack, Row, Container, Spacer, Divider } from "@/web/components/layout";

function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <Stack className="min-h-screen bg-surface-1">
      <Row className="px-r3 py-r5 bg-surface-0 border-b border-border-default">
        <span className="text-h6 font-bold">App Name</span>
        <Spacer />
        <button>Sign In</button>
      </Row>

      <Container size="lg" className="py-r2">
        <Stack gap="r3">{children}</Stack>
      </Container>

      <Spacer />
      <Divider />
      <Container size="lg" className="py-r3">
        <Row justify="between">
          <span className="text-body-3 text-text-secondary">&copy; 2025 App Name</span>
          <Row gap="r4">
            <a href="/terms">Terms</a>
            <Divider orientation="vertical" />
            <a href="/privacy">Privacy</a>
          </Row>
        </Row>
      </Container>
    </Stack>
  );
}
```

### Dashboard Content Area

Combining `Container`, `Stack`, `Row`, and `Divider` for a settings page:

```tsx
<Container size="lg">
  <Stack gap="r3" className="py-r2">
    <h1 className="text-h3">Settings</h1>

    <Stack gap="r4">
      <Row justify="between">
        <Stack gap="r6">
          <span className="text-body-1 font-semibold">Display Name</span>
          <span className="text-body-2 text-text-secondary">John Doe</span>
        </Stack>
        <button>Edit</button>
      </Row>

      <Divider />

      <Row justify="between">
        <Stack gap="r6">
          <span className="text-body-1 font-semibold">Email</span>
          <span className="text-body-2 text-text-secondary">john@example.com</span>
        </Stack>
        <button>Edit</button>
      </Row>

      <Divider />

      <Row justify="between">
        <Stack gap="r6">
          <span className="text-body-1 font-semibold">Plan</span>
          <span className="text-body-2 text-text-secondary">Pro</span>
        </Stack>
        <button>Upgrade</button>
      </Row>
    </Stack>
  </Stack>
</Container>
```

### Centered Auth Card

Using `Center` with `Container` and `Stack`:

```tsx
<Center className="min-h-screen bg-surface-1">
  <Container size="sm">
    <Stack gap="r3" className="bg-surface-0 rounded-lg shadow-md p-r2">
      <h2 className="text-h4 text-center">Welcome Back</h2>
      <form>
        <Stack gap="r4">
          <input placeholder="Email" />
          <input type="password" placeholder="Password" />
          <button>Sign In</button>
        </Stack>
      </form>
    </Stack>
  </Container>
</Center>
```

---

## Responsive Spacing Reference

All `gap` values are responsive tokens that scale at the 640px breakpoint:

| Token | Mobile | Desktop (>=640px) |
| ----- | ------ | ----------------- |
| `r1`  | 36px   | 96px              |
| `r2`  | 20px   | 32px              |
| `r3`  | 16px   | 24px              |
| `r4`  | 12px   | 20px              |
| `r5`  | 8px    | 12px              |
| `r6`  | 4px    | 4px               |

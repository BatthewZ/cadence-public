# ThemeSwitcher

A radio-group style control that lets users switch between the available design system themes. Reads and writes the `data-theme` attribute on `<html>` and persists the selection to `localStorage`.

**Source:** `src/web/components/ui/ThemeSwitcher.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `ref` | `Ref<HTMLDivElement>` | -- | Forwarded ref to the root `<div>`. |
| `...rest` | -- | -- | All remaining `<div>` props (except `children`) are spread onto the root element. |

### Available Themes

| Theme Key | Label | Description |
| --- | --- | --- |
| `default` | Default | The base design system theme. Removes the `data-theme` attribute. |
| `events` | Events | Theme optimized for events/entertainment UIs. |
| `grimdark` | Grimdark | Dark, heavy-weight theme with slow, cinematic motion. |
| `tech` | Tech | Snappy, modern SaaS-style theme. |

### How It Works

1. The component uses the `useTheme()` hook from `@/web/hooks/use-theme`.
2. `useTheme()` reads the current theme from `document.documentElement.getAttribute("data-theme")` via `useSyncExternalStore`, and observes changes via a `MutationObserver`.
3. Selecting a theme sets `data-theme` on `<html>` and saves it to `localStorage` under the `"theme"` key.
4. Selecting "Default" removes the `data-theme` attribute and clears the localStorage entry.
5. The component renders as a `role="radiogroup"` with individual `role="radio"` buttons, each with `aria-checked` reflecting the active state.
6. On page load, a blocking inline `<script>` in `src/web/index.html` restores the saved theme before the first paint, preventing FOUC. See [FOUC prevention](../design-system/theming.md#fouc-prevention).
7. When a theme mutation is in-flight (`ThemeControlValue.isPending` is `true`), the palette icon in the trigger button is replaced with a [`Spinner`](spinner.md) to provide visual feedback that the API call is in progress.

### CSS Classes

The component uses BEM-style CSS classes:

- `theme-switcher` -- root container
- `theme-switcher__option` -- each theme button
- `theme-switcher__option--active` -- the currently selected theme button

## Usage

### Basic Usage

```tsx
import { ThemeSwitcher } from "@/web/components/ui/ThemeSwitcher";

<ThemeSwitcher />
```

### In a Settings Panel

```tsx
import { Card } from "@/web/components/ui/Card";
import { Text } from "@/web/components/ui/Text";
import { Stack } from "@/web/components/layout/Stack";
import { ThemeSwitcher } from "@/web/components/ui/ThemeSwitcher";

<Card>
  <Stack gap="r4">
    <Text variant="h6">Appearance</Text>
    <Text variant="body-2" color="secondary">
      Choose a theme that suits your preference.
    </Text>
    <ThemeSwitcher />
  </Stack>
</Card>
```

### In a Navigation Bar

```tsx
import { Row } from "@/web/components/layout/Row";
import { Spacer } from "@/web/components/layout/Spacer";
import { Text } from "@/web/components/ui/Text";
import { ThemeSwitcher } from "@/web/components/ui/ThemeSwitcher";

<Row className="px-r3 py-r5 bg-surface-0 border-b border-border-default">
  <Text variant="h6">My App</Text>
  <Spacer />
  <ThemeSwitcher />
</Row>
```

### Programmatic Theme Control

If you need to set the theme programmatically without rendering the switcher UI, use the `useTheme` hook directly.

```tsx
import { useTheme } from "@/web/hooks/use-theme";

function MyComponent() {
  const { theme, setTheme, themes } = useTheme();

  return (
    <select value={theme} onChange={(e) => setTheme(e.target.value as any)}>
      {themes.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );
}
```

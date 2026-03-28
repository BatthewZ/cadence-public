# Alert

Block-level status message with semantic `role="alert"` and `aria-live="polite"` for accessibility. Suitable for form errors, success confirmations, warnings, and informational messages.

**Source:** `src/web/components/ui/Alert.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `"success" \| "warning" \| "error" \| "info"` | `"info"` | Visual style indicating the alert severity. |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `ref` | `Ref<HTMLDivElement>` | -- | Forwarded ref to the root `<div>`. |
| `...rest` | -- | -- | All remaining `<div>` props are spread onto the root element. |

### Base Classes

```
flex gap-r5 rounded-md p-r4 text-body-2
```

### Variant Classes

| Variant | Classes Applied |
| --- | --- |
| `success` | `bg-status-success-bg text-status-success border border-status-success/20` |
| `warning` | `bg-status-warning-bg text-status-warning border border-status-warning/20` |
| `error` | `bg-status-error-bg text-status-error border border-status-error/20` |
| `info` | `bg-status-info-bg text-status-info border border-status-info/20` |

### Accessibility

The component renders with `role="alert"` and `aria-live="polite"`, which means screen readers will announce the content when it appears in the DOM.

## Usage

### All Variants

```tsx
import { Alert } from "@/web/components/ui/Alert";

<Alert variant="info">Your session will expire in 5 minutes.</Alert>
<Alert variant="success">Your changes have been saved.</Alert>
<Alert variant="warning">This action cannot be undone easily.</Alert>
<Alert variant="error">Failed to save. Please try again.</Alert>
```

### Alert with Icon

Compose with a Lucide icon inside the flex container. The `gap-r5` base class provides spacing between the icon and text.

```tsx
import { Alert } from "@/web/components/ui/Alert";
import { AlertCircle, CheckCircle, Info, TriangleAlert } from "lucide-react";

<Alert variant="error">
  <AlertCircle className="size-5 shrink-0 mt-0.5" />
  <span>Your password must be at least 8 characters.</span>
</Alert>

<Alert variant="success">
  <CheckCircle className="size-5 shrink-0 mt-0.5" />
  <span>Account created successfully!</span>
</Alert>

<Alert variant="warning">
  <TriangleAlert className="size-5 shrink-0 mt-0.5" />
  <span>Storage is almost full. Consider upgrading your plan.</span>
</Alert>

<Alert variant="info">
  <Info className="size-5 shrink-0 mt-0.5" />
  <span>A new version is available. Refresh to update.</span>
</Alert>
```

### Alert with Rich Content

```tsx
import { Alert } from "@/web/components/ui/Alert";
import { Text } from "@/web/components/ui/Text";
import { Stack } from "@/web/components/layout/Stack";

<Alert variant="error">
  <Stack gap="r6">
    <Text variant="body-2" weight="semibold" color="primary" as="span"
      className="text-status-error">
      Upload failed
    </Text>
    <Text variant="body-3" as="span" className="text-status-error/80">
      The file exceeded the 10MB size limit. Please compress and try again.
    </Text>
  </Stack>
</Alert>
```

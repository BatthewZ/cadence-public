# Toast

Notification toast system consisting of a `Toast` display component, a `ToastProvider` context wrapper, and a `useToast` hook for imperatively triggering toasts from anywhere in the component tree.

**Source:** `src/web/components/ui/Toast.tsx`, `src/web/components/ui/ToastContext.tsx`

## Architecture

1. **`ToastProvider`** -- Wrap your app (or a subtree) in this provider. It manages toast state and renders a portal to `document.body` with all active toasts positioned at the bottom-right of the viewport.
2. **`useToast()`** -- Hook that returns the toast API. Must be called inside a `ToastProvider`.
3. **`Toast`** -- The visual toast component (used internally by the provider; you typically do not render it directly).

## Toast Component Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `"success" \| "warning" \| "error" \| "info"` | `"info"` | Visual style indicating the toast severity. |
| `title` | `string` | -- | Optional bold title rendered above the message. |
| `action` | `ToastAction` | -- | Optional action button (e.g., "Undo"). Clicking it fires `action.onClick()` then auto-dismisses. |
| `onDismiss` | `() => void` | **(required)** | Callback fired when the dismiss button is clicked. |
| `dismissing` | `boolean` | `false` | When `true`, plays the exit animation (`animate-slide-out-right`). |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `children` | `ReactNode` | -- | The toast message body. |
| `ref` | `Ref<HTMLDivElement>` | -- | Forwarded ref to the root `<div>`. |

### Variant Classes

| Variant | Classes | ARIA Role |
| --- | --- | --- |
| `success` | `bg-status-success-bg text-status-success border-status-success/20` | `status` (polite) |
| `warning` | `bg-status-warning-bg text-status-warning border-status-warning/20` | `status` (polite) |
| `error` | `bg-status-error-bg text-status-error border-status-error/20` | `alert` (assertive) |
| `info` | `bg-status-info-bg text-status-info border-status-info/20` | `status` (polite) |

### Base Classes

```
flex items-start gap-r5 rounded-md p-r4 text-body-2 shadow-lg border w-80 pointer-events-auto
```

Entrance animation: `animate-slide-in-right`. Exit animation: `animate-slide-out-right`.

## useToast API

```ts
const { toast, dismiss, dismissAll } = useToast();
```

| Method | Signature | Description |
| --- | --- | --- |
| `toast` | `(message: string, options?: ToastOptions) => string` | Show a toast and return its unique ID. |
| `dismiss` | `(id: string) => void` | Dismiss a specific toast by ID. |
| `dismissAll` | `() => void` | Dismiss all visible toasts. |

### ToastOptions

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `"success" \| "warning" \| "error" \| "info"` | `"info"` | Visual variant. |
| `title` | `string` | -- | Optional bold title. |
| `duration` | `number` | `5000` | Auto-dismiss delay in milliseconds. Set to `0` to disable auto-dismiss. |
| `action` | `ToastAction` | -- | Optional action button rendered inside the toast. See `ToastAction` below. |

### ToastAction

| Property | Type | Description |
| --- | --- | --- |
| `label` | `string` | Text displayed on the action button (e.g., `"Undo"`). |
| `onClick` | `() => void` | Callback fired when the action button is clicked. The toast is automatically dismissed after `onClick` runs. |

### Behavior

- Maximum **5** toasts visible at once. When a new toast exceeds the limit, the oldest is automatically dismissed.
- Toasts auto-dismiss after `5000ms` by default.
- Dismiss animation lasts `300ms` before the toast is removed from the DOM.
- Toasts are rendered via `createPortal` into `document.body`, positioned at `fixed bottom-r4 right-r4 z-50`.

## Usage

### Setup: Wrap Your App

```tsx
import { ToastProvider } from "@/web/components/ui/ToastContext";

function App() {
  return (
    <ToastProvider>
      <YourAppContent />
    </ToastProvider>
  );
}
```

### Triggering Toasts

```tsx
import { useToast } from "@/web/components/ui/ToastContext";
import { Button } from "@/web/components/ui/Button";

function SaveButton() {
  const { toast } = useToast();

  const handleSave = async () => {
    try {
      await saveData();
      toast("Your changes have been saved.", { variant: "success" });
    } catch {
      toast("Failed to save. Please try again.", { variant: "error" });
    }
  };

  return <Button onClick={handleSave}>Save</Button>;
}
```

### All Variants

```tsx
const { toast } = useToast();

toast("File uploaded successfully.", { variant: "success", title: "Upload complete" });
toast("Your session will expire soon.", { variant: "warning", title: "Warning" });
toast("Could not connect to server.", { variant: "error", title: "Connection error" });
toast("A new version is available.", { variant: "info" });
```

### Custom Duration

```tsx
const { toast } = useToast();

// Stays for 10 seconds
toast("This will stay longer.", { duration: 10000 });

// Never auto-dismisses
toast("Dismiss me manually.", { duration: 0, variant: "warning" });
```

### With Action Button

```tsx
const { toast } = useToast();

// Toast with an undo action
toast("Item deleted.", {
  variant: "success",
  action: { label: "Undo", onClick: () => restoreItem() },
});
```

### Dismissing Programmatically

```tsx
const { toast, dismiss, dismissAll } = useToast();

const id = toast("Processing...", { variant: "info", duration: 0 });

// Later, dismiss that specific toast
dismiss(id);

// Or dismiss everything
dismissAll();
```

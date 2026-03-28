# Dialog

Modal dialog built on the native `<dialog>` HTML element. Uses `showModal()` and `close()` for proper modal behavior including focus trapping and backdrop. Adds the `no-body-scroll` class to prevent background scrolling when open.

**Source:** `src/web/components/ui/Dialog.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `open` | `boolean` | -- | Controls whether the dialog is open. When `true`, calls `dialog.showModal()`; when `false`, calls `dialog.close()`. |
| `onClose` | `() => void` | -- | Callback fired when the dialog should close (e.g., user presses Escape). |
| `className` | `string` | -- | Additional CSS classes merged via `cn()`. |
| `ref` | `Ref<HTMLDialogElement>` | -- | Forwarded ref to the root `<dialog>` element. |
| `...rest` | -- | -- | All remaining `<dialog>` props are spread onto the root element. |

### Base Classes

```
no-body-scroll bg-surface-0 rounded-lg shadow-lg p-r2 animate-fade-in max-w-[640px] w-full m-auto
backdrop:bg-black/50
```

### Behavior

- **Open/close** is controlled by the `open` prop. The component calls `dialog.showModal()` or `dialog.close()` in a `useEffect`.
- **Escape key** triggers the native `cancel` event, which is intercepted to call `onClose()` (the default event is prevented so the component stays in controlled mode).
- **Backdrop** is styled via `backdrop:bg-black/50`.
- **Scroll lock** is handled by the `no-body-scroll` CSS class on the `<dialog>` element, which is picked up by `body:has(dialog[open].no-body-scroll)` in the global stylesheet.
- **Entrance animation** uses `animate-fade-in`.

## Usage

### Basic Modal

```tsx
import { useState } from "react";
import { Dialog } from "@/web/components/ui/Dialog";
import { Button } from "@/web/components/ui/Button";
import { Text } from "@/web/components/ui/Text";
import { Stack } from "@/web/components/layout/Stack";

function ConfirmDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Dialog</Button>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <Stack gap="r4">
          <Text variant="h5">Confirm Action</Text>
          <Text variant="body-2" color="secondary">
            Are you sure you want to proceed? This action cannot be undone.
          </Text>
          <div className="flex justify-end gap-r5 pt-r4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              Delete
            </Button>
          </div>
        </Stack>
      </Dialog>
    </>
  );
}
```

### Modal with Form Content

```tsx
import { useState } from "react";
import { Dialog } from "@/web/components/ui/Dialog";
import { Button } from "@/web/components/ui/Button";
import { Text } from "@/web/components/ui/Text";
import { Stack } from "@/web/components/layout/Stack";

function EditProfileDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Edit Profile</Button>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <Stack gap="r3">
          <Text variant="h5">Edit Profile</Text>

          <form onSubmit={(e) => { e.preventDefault(); setOpen(false); }}>
            <Stack gap="r4">
              <div className="flex flex-col gap-r6">
                <label className="text-body-2 font-semibold text-fg-primary">
                  Display Name
                </label>
                <input
                  className="w-full px-r4 py-r5 text-body-2 bg-surface-0 border border-border-strong rounded-md"
                  defaultValue="Jane Doe"
                />
              </div>

              <div className="flex flex-col gap-r6">
                <label className="text-body-2 font-semibold text-fg-primary">
                  Bio
                </label>
                <textarea
                  className="w-full px-r4 py-r5 text-body-2 bg-surface-0 border border-border-strong rounded-md min-h-[100px] resize-y"
                  defaultValue="Software engineer and coffee enthusiast."
                />
              </div>

              <div className="flex justify-end gap-r5 pt-r4">
                <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Save Changes
                </Button>
              </div>
            </Stack>
          </form>
        </Stack>
      </Dialog>
    </>
  );
}
```

### Custom Width

Override the default `max-w-[640px]` via `className`.

```tsx
<Dialog open={open} onClose={handleClose} className="max-w-sm">
  <Text variant="body-2">A narrower dialog.</Text>
</Dialog>
```

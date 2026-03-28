# ConfirmDialog

A pre-built confirmation modal for destructive actions. Wraps the base [`Dialog`](dialog.md) component with a title, description, Cancel button, and a danger-variant Confirm button.

**Source:** `src/web/components/ui/ConfirmDialog.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `open` | `boolean` | **(required)** | Controls dialog visibility. |
| `onClose` | `() => void` | **(required)** | Called when Cancel is clicked or the dialog is dismissed. |
| `onConfirm` | `() => void` | **(required)** | Called when the confirm button is clicked. |
| `title` | `string` | **(required)** | Dialog heading text. |
| `children` | `ReactNode` | **(required)** | Description body rendered as secondary text. |
| `confirmLabel` | `string` | `"Delete"` | Label for the confirm button in its default state. |
| `confirmingLabel` | `string` | `"Deleting..."` | Label shown while `confirming` is `true`. |
| `confirming` | `boolean` | `false` | When `true`, disables both buttons and shows `confirmingLabel`. |

## Usage

```tsx
import { useState } from "react";
import { ConfirmDialog } from "@/web/components/ui";

function DeleteProjectButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    await onDelete();
    setOpen(false);
    setDeleting(false);
  };

  return (
    <>
      <button onClick={() => setOpen(true)}>Delete Project</button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
        title="Delete project?"
        confirming={deleting}
      >
        This action cannot be undone. All tasks and data will be permanently removed.
      </ConfirmDialog>
    </>
  );
}
```

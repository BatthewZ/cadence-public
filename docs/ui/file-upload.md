# FileUpload

A drag-and-drop file upload dropzone component with keyboard accessibility. CSS-only styling, no JS animation libraries.

**Source:** `src/web/components/ui/FileUpload.tsx`
**Styles:** `src/web/style/components/file-upload.css`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `accept` | `string[]` | -- | Accepted MIME types (e.g. `["image/png", "image/jpeg"]`). |
| `maxSize` | `number` | -- | Maximum file size in bytes. |
| `multiple` | `boolean` | `false` | Allow selecting multiple files. |
| `onFilesSelected` | `(files: File[]) => void` | -- | Called when valid files are selected (via drop or browse). |
| `disabled` | `boolean` | `false` | Disable the dropzone. |
| `hint` | `string` | Auto-generated from `maxSize` | Hint text shown below the main prompt. |
| `error` | `string \| null` | -- | Error message to display. |
| `success` | `string \| null` | -- | Success message to display. |
| `uploading` | `boolean` | `false` | Whether the component is in an uploading state. |
| `className` | `string` | -- | Additional CSS classes. |
| `ref` | `Ref<HTMLDivElement>` | -- | Forwarded ref to the root element. |

## Behavior

- **Drag and drop:** Files dropped onto the zone are validated against `accept` and `maxSize` before being passed to `onFilesSelected`.
- **Browse:** Clicking or pressing Enter/Space opens the native file picker.
- **Validation:** Files that don't match `accept` or exceed `maxSize` are silently filtered out.
- **States:** Visual feedback via CSS classes for drag-over, uploading, success, error, and disabled states.
- **Accessibility:** Uses `role="button"` with `tabIndex={0}`, keyboard-operable, `aria-label="Upload file"`.

## CSS Classes

| Class | State |
| --- | --- |
| `file-upload` | Base |
| `file-upload--drag-over` | File is being dragged over the zone |
| `file-upload--uploading` | Upload in progress |
| `file-upload--success` | Upload succeeded |
| `file-upload--error` | Error occurred |
| `file-upload--disabled` | Dropzone is disabled |

## Usage

```tsx
import { FileUpload } from "@/web/components/ui";

function DocumentUpload() {
  return (
    <FileUpload
      accept={["application/pdf", "image/png"]}
      maxSize={5 * 1024 * 1024}
      onFilesSelected={(files) => console.log(files)}
      hint="PDF or PNG, up to 5 MB"
    />
  );
}
```

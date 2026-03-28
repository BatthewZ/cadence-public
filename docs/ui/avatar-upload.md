# AvatarUpload

A circular avatar upload component that wraps the [`Avatar`](avatar.md) component with click-to-upload behavior, optimistic preview, and a hover overlay.

**Source:** `src/web/components/ui/AvatarUpload.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string \| null` | -- | Current avatar image URL. |
| `name` | `string` | -- | User display name (used for initials fallback). |
| `size` | `"xs" \| "sm" \| "md" \| "lg" \| "xl"` | `"xl"` | Avatar size. |
| `onUploadComplete` | `(data: UploadResult) => void` | -- | Called after a successful upload with the response data. |
| `className` | `string` | -- | Additional CSS classes. |
| `ref` | `Ref<HTMLDivElement>` | -- | Forwarded ref to the root element. |

## Behavior

1. **Click/keyboard** opens the native file picker (JPEG, PNG, GIF, WebP only).
2. **Client-side validation** checks file type and size (max 2 MB) via [`useFileUpload`](hooks.md#usefileupload).
3. **Optimistic preview** shows the selected image immediately via `URL.createObjectURL`.
4. **Upload** sends the file as `multipart/form-data` to `PUT /api/users/me/avatar`.
5. **On success**, the preview URL is replaced with the permanent server URL and `onUploadComplete` fires.
6. **On failure**, the preview reverts to the original `src`.

## Hover Overlay

A semi-transparent overlay with a camera icon appears on hover/focus. During upload, it shows a spinning indicator.

## Error Display

Validation and upload errors appear as a tooltip below the avatar via `role="alert"`.

## Dependencies

- [`Avatar`](avatar.md) -- renders the avatar image/initials
- [`useFileUpload`](hooks.md#usefileupload) -- manages upload state and API call
- [`upload` validation schemas](../api/storage.md#validation-schemas) -- `ALLOWED_IMAGE_TYPES`, `MAX_AVATAR_SIZE`

## Usage

```tsx
import { AvatarUpload } from "@/web/components/ui";

function ProfileSettings({ user }) {
  return (
    <AvatarUpload
      src={user.image}
      name={user.name}
      size="xl"
      onUploadComplete={(data) => console.log("Uploaded:", data.upload.url)}
    />
  );
}
```

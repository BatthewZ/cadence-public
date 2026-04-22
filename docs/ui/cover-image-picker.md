# CoverImagePicker

Modal picker that lets the user choose a cover image from either a local upload or the Unsplash library. Built on top of `Dialog` and `Tabs`. The Unsplash tab is feature-gated behind the server-side `features.unsplash` flag — when the integration is disabled the picker collapses to a single upload panel with no visible tab bar.

**Source:** `src/web/components/ui/CoverImagePicker.tsx`

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `open` | `boolean` | Controls dialog visibility. |
| `onClose` | `() => void` | Called when the dialog should close (close button or successful selection). |
| `onUploadFile` | `(file: File) => void` | Called with the (optimized) file when the user picks a local image. Parent wires the actual upload. |
| `onSelectUnsplash` | `(payload: UnsplashCoverPayload) => void` | Called when the user picks an Unsplash photo. Parent wires the apply call. |
| `initialTab` | `"upload" \| "unsplash"` (optional) | Override the default active tab. When omitted the picker opens on the Unsplash tab if the feature flag is on, otherwise on Upload. |

## Behavior

- **Feature gating.** The component reads `useFeatures().data?.unsplash`. When `false` the Unsplash `Tabs.Tab` and `Tabs.Panel` are not rendered — only the upload panel is shown, and the tab list is hidden entirely.
- **Lazy Unsplash queries.** `useUnsplashSearch` is only enabled while `open === true && activeTab === "unsplash"`. Users who never open the picker (or never switch to the Unsplash tab) do not hit the shared Unsplash quota.
- **Tab reset on close/open.** Closing the picker resets the active tab to the resolved default so the next open is deterministic. A secondary guard redirects to `upload` if the feature flag loads late and the user is stuck on the Unsplash tab.
- **Upload panel.** Validates the file via `useFileUpload().validate` against `ALLOWED_IMAGE_TYPES` and `MAX_UPLOAD_SIZE`, then runs it through `optimizeImage(file, COVER_PRESET)`. Animated GIFs bypass optimization so the animation is preserved (Canvas would flatten to a single frame). Supports click-to-browse, drag-and-drop, and keyboard activation (Enter/Space on the drop zone).
- **Unsplash panel.** Debounced search input + orientation filter (`landscape` default, also `portrait` / `squarish` / `any`). Infinite-scrolls via an `IntersectionObserver` sentinel with a 200px `rootMargin`. Errors surface with a retry button; 429/503 surface immediately (no silent retry). Empty states differ between "search returned nothing" and "curated list is empty".
- **Attribution.** Every photo card renders the photographer name linked to their Unsplash profile (`target="_blank"` + `rel="noopener noreferrer"`). A sticky footer credits Unsplash with the required `utm_source=cadence&utm_medium=referral` params. UTM params on photo/profile URLs are appended server-side in `toCoverPayload` — not duplicated client-side.
- **Photo card interaction.** The card is a `<button>` so the whole tile is keyboard-activatable. The photographer credit is a nested anchor with `stopPropagation` so clicking it opens the profile without selecting the photo.
- **Card thumbnail rendition.** Each card `<img src>` is composed via `buildUnsplashDisplayUrl(photo, "card")` (imgix `w=500&q=75&auto=format&fit=max` appended to `rawUrl`) so retina cards render crisply at ~250--350 CSS px × 2x DPR without paying the full `thumbUrl`→`regular` bandwidth. Legacy rows without `rawUrl` fall back to the pre-baked `thumbUrl`.

## Accessibility

- Dialog is labelled by `cover-image-picker-title`.
- Upload drop zone is a `role="button"` with keyboard handlers and `aria-disabled` while busy.
- Photo grid is `role="listbox"` with `aria-label="Unsplash photos"`; each card's button has a descriptive `aria-label` (`Use photo by <name>`).
- Errors and busy states are announced via `aria-live="polite"` regions.

## Usage

```tsx
import { CoverImagePicker } from "@/web/components/ui/CoverImagePicker";
import { useProjectCover } from "@/web/hooks/use-project-cover";

const cover = useProjectCover(projectId);

<CoverImagePicker
  open={pickerOpen}
  onClose={() => setPickerOpen(false)}
  onUploadFile={cover.handleUpload}
  onSelectUnsplash={cover.handleApplyUnsplash}
/>
```

## Dependencies

- [`Dialog`](dialog.md), [`Tabs`](tabs.md), [`Alert`](alert.md), [`Button`](button.md), [`Skeleton`](skeleton.md)
- [`SearchInput`](search-input.md), [`Select`](forms.md#select)
- [`useFeatures`](hooks.md#usefeatures) — feature-flag gate for the Unsplash tab
- [`useUnsplashSearch`](hooks.md#useunsplashsearch) — infinite-query wrapper for curated/search
- [`useFileUpload`](hooks.md#usefileupload) — client-side file validation
- `image-optimization` (`optimizeImage`, `COVER_PRESET`, `isAnimatedGif`)
- Shared schemas: `UnsplashCoverPayload`, `ALLOWED_IMAGE_TYPES`, `MAX_UPLOAD_SIZE`

## Why the attribution rules are non-negotiable

Unsplash's API guidelines mandate a visible photographer credit and a profile link on every displayed photo. Breaking this can get the integration's API key revoked. The component enforces this structurally — there is no prop to hide attribution — and the `toCoverPayload` server helper guarantees `photoUrl` / `profileUrl` always carry the correct UTM params before the payload ever reaches the client.

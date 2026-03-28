# Pagination

Page navigation control with numbered page buttons, ellipsis for large ranges, and edge navigation. Supports full and compact variants. Uses the existing `IconButton` component for navigation controls.

**Source:** `src/web/components/ui/Pagination.tsx`
**Styles:** `src/web/style/components/pagination.css`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `page` | `number` | **required** | Current active page (1-indexed). |
| `totalPages` | `number` | **required** | Total number of pages. |
| `onPageChange` | `(page: number) => void` | **required** | Callback when a page is selected. |
| `siblingCount` | `number` | `1` | Number of page buttons to show on each side of the current page. |
| `showEdges` | `boolean` | `true` | Show first/last page navigation buttons (full variant only). |
| `variant` | `"full" \| "compact"` | `"full"` | `full` shows numbered page buttons. `compact` shows "Page X of Y" text. |
| `className` | `string` | -- | Additional CSS classes on the root `<nav>`. |

## Variants

### Full (default)

Displays numbered page buttons with ellipsis for large ranges. Includes first/last and prev/next navigation buttons.

Page range algorithm:
- Always shows the first and last page
- Shows `siblingCount` pages on each side of the current page
- Inserts ellipsis (`...`) when there are gaps between visible ranges

### Compact

Displays "Page **X** of **Y**" text with prev/next buttons only. Useful for mobile or tight layouts.

## Navigation Buttons

| Button | Icon | Shown | Description |
| --- | --- | --- | --- |
| First page | `ChevronsLeft` | Full variant + `showEdges` | Jumps to page 1. |
| Previous | `ChevronLeft` | Always | Goes to `page - 1`. |
| Next | `ChevronRight` | Always | Goes to `page + 1`. |
| Last page | `ChevronsRight` | Full variant + `showEdges` | Jumps to `totalPages`. |

All navigation buttons are disabled at their respective boundaries (first/last page).

## Accessibility

- Root `<nav>` has `aria-label="Pagination"`.
- Current page button has `aria-current="page"`.
- Each page button has `aria-label="Page N"`.
- Navigation buttons have descriptive `aria-label` values ("First page", "Previous page", etc.).
- Ellipsis elements are `aria-hidden="true"`.
- `prefers-reduced-motion: reduce` disables hover transitions.

## Usage

### Basic

```tsx
import { useState } from "react";
import { Pagination } from "@/web/components/ui/Pagination";

function PaginatedList() {
  const [page, setPage] = useState(1);

  return (
    <>
      {/* List content */}
      <Pagination page={page} totalPages={10} onPageChange={setPage} />
    </>
  );
}
```

### Compact Variant

```tsx
<Pagination
  page={page}
  totalPages={50}
  onPageChange={setPage}
  variant="compact"
/>
```

### Custom Sibling Count

```tsx
<Pagination
  page={page}
  totalPages={20}
  onPageChange={setPage}
  siblingCount={2}
/>
```

### Without Edge Buttons

```tsx
<Pagination
  page={page}
  totalPages={10}
  onPageChange={setPage}
  showEdges={false}
/>
```

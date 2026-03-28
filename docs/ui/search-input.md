# SearchInput

A search input with a search icon, clear button, and optional debounce support. Built on top of the `Input` component.

**Source:** `src/web/components/form/SearchInput.tsx`
**CSS:** `src/web/style/components/search-input.css`

---

## Props

| Prop          | Type                       | Default        | Description                                   |
| ------------- | -------------------------- | -------------- | --------------------------------------------- |
| `value`       | `string`                   | --             | The current search value (controlled)         |
| `onChange`     | `(value: string) => void`  | --             | Called with the new value when the input changes |
| `placeholder` | `string`                   | `"Search..."`  | Placeholder text                              |
| `onClear`     | `() => void`               | --             | Called when the clear button is clicked        |
| `size`        | `"sm" \| "md"`             | `"md"`         | Input size variant                            |
| `className`   | `string`                   | --             | Additional CSS classes on the wrapper          |

Also accepts all native `input` props except `onChange`, `value`, `type`, and `size`.

---

## Features

- Search icon (lucide `Search`) on the left
- Clear button (lucide `X`) on the right when value is non-empty
- `type="search"` with `role="searchbox"`
- Escape key clears the input
- `aria-label="Search"` by default

---

## Usage

### Basic

```tsx
import { useState } from "react";
import { SearchInput } from "@/web/components/form/SearchInput";

function FilterList() {
  const [query, setQuery] = useState("");
  return <SearchInput value={query} onChange={setQuery} />;
}
```

### With Debounce

Combine with the `useDebounce` hook for delayed search:

```tsx
import { useEffect, useState } from "react";
import { SearchInput } from "@/web/components/form/SearchInput";
import { useDebounce } from "@/web/hooks/use-debounce";

function SearchPage() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    fetchResults(debouncedQuery);
  }, [debouncedQuery]);

  return <SearchInput value={query} onChange={setQuery} placeholder="Search users..." />;
}
```

### Small Size

```tsx
<SearchInput value={query} onChange={setQuery} size="sm" />
```

### With Clear Callback

```tsx
<SearchInput
  value={query}
  onChange={setQuery}
  onClear={() => console.log("Search cleared")}
/>
```

---

## Accessibility Notes

- The input has `role="searchbox"` and `aria-label="Search"` for screen reader identification.
- The clear button has `aria-label="Clear search"`.
- The search icon is marked `aria-hidden="true"`.
- The clear button has a visible `:focus-visible` ring for keyboard users.
- Pressing Escape clears the search input.

# Utilities

## The `cn()` Utility Function

**File:** `src/web/util/style/style.ts`

```ts
import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["h1", "h2", "h3", "h4", "h5", "h6", "body-1", "body-2", "body-3"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

`cn()` combines `clsx` (conditional class joining) with `tailwind-merge` (deduplicating and resolving conflicting Tailwind classes). It is extended to recognize the custom typography classes (`text-h1` through `text-body-3`) so they merge correctly with other `text-*` utilities.

**Usage in components:**

```tsx
<div className={cn("flex flex-col gap-r3 max-w-5xl mx-auto w-full", className)} />
```

This lets consumers pass a `className` prop for one-off overrides while the component's base styles are preserved and conflicting classes are resolved intelligently.

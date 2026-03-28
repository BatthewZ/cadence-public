# Portal

Utility component that renders children into a DOM node outside the parent component tree using `ReactDOM.createPortal`. Used by overlay components (tooltips, popovers, dropdowns) to escape parent `overflow: hidden` or `z-index` stacking contexts.

**Source:** `src/web/components/ui/Portal.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | -- | Content to render inside the portal. |
| `container` | `Element \| null` | `document.body` | Target DOM node. Falls back to `document.body` when omitted or `null`. |

## Behavior

- **SSR-safe:** Returns `null` when `document` is not available (server-side rendering).
- **No wrapper element:** Portal renders no DOM element of its own -- children are placed directly into the target container.
- This is a utility component, so it intentionally omits `className`, `forwardRef`, and prop spreading (it has no root DOM element to forward to).

## Usage

### Basic Portal

```tsx
import { Portal } from "@/web/components/ui/Portal";

function Tooltip({ children }: { children: React.ReactNode }) {
  return (
    <Portal>
      <div className="fixed z-50">{children}</div>
    </Portal>
  );
}
```

### Custom Container

```tsx
import { useRef } from "react";
import { Portal } from "@/web/components/ui/Portal";

function OverlayRoot() {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={containerRef} id="overlay-root" />
      <Portal container={containerRef.current}>
        <div>Rendered inside #overlay-root</div>
      </Portal>
    </>
  );
}
```

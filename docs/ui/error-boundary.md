# ErrorBoundary

React class component that catches JavaScript errors in its child component tree, prevents the entire app from crashing, and renders a fallback UI with a retry button.

**Source:** `src/web/components/ui/ErrorBoundary.tsx`

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | **required** | The component tree to wrap and protect from uncaught errors. |

## Behavior

When a descendant component throws during rendering, in a lifecycle method, or in a constructor:

1. `getDerivedStateFromError` sets `hasError` to `true`.
2. The fallback UI renders instead of the broken child tree.
3. The fallback displays:
   - A heading: "Something went wrong"
   - A description: "An unexpected error occurred."
   - A "Try again" button that resets `hasError` to `false`, re-attempting to render the children.

The fallback UI is centered on screen (`min-h-screen`) with `bg-surface-1` background, using the design system's color tokens and button styles.

## Limitations

- **Does not catch:** errors in event handlers, asynchronous code (setTimeout, fetch), or server-side rendering. Only errors thrown during React rendering are caught.
- **No custom fallback prop:** The fallback UI is built-in. To customize, modify the component source or create a variant.
- **No error reporting:** The component does not log errors to an external service. Add `componentDidCatch` if you need error reporting.

## Usage

### Wrapping a Page

```tsx
import { ErrorBoundary } from "@/web/components/ui/ErrorBoundary";

function App() {
  return (
    <ErrorBoundary>
      <MainLayout>
        <PageContent />
      </MainLayout>
    </ErrorBoundary>
  );
}
```

### Wrapping a Section

```tsx
import { ErrorBoundary } from "@/web/components/ui/ErrorBoundary";

function Dashboard() {
  return (
    <div>
      <h1 className="text-h3 font-bold">Dashboard</h1>

      <ErrorBoundary>
        <AnalyticsChart />
      </ErrorBoundary>

      <ErrorBoundary>
        <RecentActivity />
      </ErrorBoundary>
    </div>
  );
}
```

### Isolating Third-Party Components

```tsx
import { ErrorBoundary } from "@/web/components/ui/ErrorBoundary";

function IntegrationPanel() {
  return (
    <ErrorBoundary>
      <ThirdPartyWidget />
    </ErrorBoundary>
  );
}
```

### Route-Level Error Boundary

```tsx
import { ErrorBoundary } from "@/web/components/ui/ErrorBoundary";

const routes = [
  {
    path: "/dashboard",
    element: (
      <ErrorBoundary>
        <DashboardPage />
      </ErrorBoundary>
    ),
  },
  {
    path: "/settings",
    element: (
      <ErrorBoundary>
        <SettingsPage />
      </ErrorBoundary>
    ),
  },
];
```

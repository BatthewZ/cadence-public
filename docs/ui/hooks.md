# Shared Hooks

Hooks that live in `src/web/hooks/` because they are shared across multiple UI components.

## useFloating

Wrapper around [`@floating-ui/react`](https://floating-ui.com/) that applies project defaults (offset, flip, shift, auto-update). Returns the full `@floating-ui/react` floating context for use with its interaction hooks.

**Source:** `src/web/hooks/use-floating.ts`

### Config

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `placement` | `Placement` | `"bottom"` | Where to position the floating element relative to the reference. |
| `offsetPx` | `number` | `8` | Distance in pixels between reference and floating element. |
| `arrowRef` | `RefObject<Element>` | -- | Ref to an arrow element for `arrow` middleware. |
| `open` | `boolean` | -- | Controlled open state, passed through to `@floating-ui/react`. |
| `onOpenChange` | `(open: boolean) => void` | -- | Callback when the open state should change. |

### Return Value

Returns the object from `@floating-ui/react`'s `useFloating` — includes `refs`, `floatingStyles`, `context`, `placement`, and more. See the [@floating-ui/react docs](https://floating-ui.com/docs/useFloating) for the full shape.

### Middleware

Applied in order: `offset` → `flip` → `shift` (8px padding) → `size` (constrains floating element height to available viewport space, 8px padding) → `arrow` (when `arrowRef` provided).

### Re-exports

The module also re-exports these from `@floating-ui/react` for convenience:

- `FloatingPortal`, `FloatingFocusManager`
- `useDismiss`, `useClick`, `useHover`, `useFocus`
- `useInteractions`, `useRole`, `useTransitionStyles`
- `useListNavigation`, `useTypeahead`
- `safePolygon` (safe-area hover handler for sub-menus)
- `Placement` (type)

### Usage

```tsx
import { useFloating, useClick, useDismiss, useInteractions } from "@/web/hooks/use-floating";
import { useState } from "react";

function Popover() {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    placement: "bottom-start",
    offsetPx: 12,
    open,
    onOpenChange: setOpen,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  return (
    <>
      <button ref={refs.setReference} {...getReferenceProps()}>
        Toggle
      </button>
      {open && (
        <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()}>
          Popover content
        </div>
      )}
    </>
  );
}
```

---

## useClickOutside

Detects mouse and touch events outside a referenced element and calls a handler. Useful for dismissing overlays when the user clicks away.

**Source:** `src/web/hooks/use-click-outside.ts`

### Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `ref` | `RefObject<Element \| null>` | -- | Ref to the element that defines the "inside" boundary. |
| `handler` | `() => void` | -- | Callback fired on outside click/touch. |
| `enabled` | `boolean` | `true` | Pass `false` to temporarily disable the listener. |

### Behavior

- Listens on `mousedown` and `touchstart` (captures the interaction before it propagates).
- The `handler` is stored in a ref so the effect does not re-attach when the callback identity changes.
- Listeners are cleaned up on unmount or when `enabled` becomes `false`.

### Usage

```tsx
import { useRef, useState } from "react";
import { useClickOutside } from "@/web/hooks/use-click-outside";

function Dropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  return (
    <div ref={ref}>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <div className="absolute">Dropdown content</div>}
    </div>
  );
}
```

---

## useFocusTrap

Traps keyboard focus (Tab / Shift+Tab) within a container element. On activation, focuses the first focusable element; on deactivation, restores focus to the previously focused element.

**Source:** `src/web/hooks/use-focus-trap.ts`

### Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `ref` | `RefObject<HTMLElement \| null>` | -- | Ref to the container that should trap focus. |
| `enabled` | `boolean` | -- | Activates/deactivates the trap. |

### Focusable Selector

Matches: `a[href]`, `button:not(:disabled)`, `input:not(:disabled)`, `select:not(:disabled)`, `textarea:not(:disabled)`, `[tabindex]:not([tabindex="-1"])`.

### Behavior

- On enable: saves `document.activeElement`, then focuses the first focusable child (or the container itself if none found).
- **Tab** on the last focusable element wraps to the first; **Shift+Tab** on the first wraps to the last.
- **Mouse clicks** outside the container are caught via a `focusin` listener that redirects focus back into the trap.
- On disable/unmount: restores focus to the previously active element.

### Usage

```tsx
import { useRef } from "react";
import { useFocusTrap } from "@/web/hooks/use-focus-trap";

function Modal({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);

  return (
    <div ref={ref} tabIndex={-1}>
      <button>First</button>
      <button>Last</button>
    </div>
  );
}
```

---

## useRovingFocus

Implements the [roving tabindex](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_roving_tabindex) keyboard navigation pattern. Only the currently focused item has `tabIndex={0}`; all others have `tabIndex={-1}`. Arrow keys, Home, and End move focus between items.

**Source:** `src/web/hooks/use-roving-focus.ts`

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `orientation` | `"horizontal" \| "vertical"` | -- | Determines which arrow keys navigate (Left/Right vs Up/Down). |
| `loop` | `boolean` | `true` | Whether navigation wraps from last to first and vice versa. |

### Return Value

| Property | Type | Description |
| --- | --- | --- |
| `getRovingProps` | `(index: number) => RovingProps` | Spread onto each item. Provides `tabIndex`, `onKeyDown`, and `ref`. |
| `focusedIndex` | `number` | The currently focused item index. |
| `setFocusedIndex` | `(index: number) => void` | Programmatically change the focused index. |

### Keyboard Mapping

| Key | Horizontal | Vertical |
| --- | --- | --- |
| Next | `ArrowRight` | `ArrowDown` |
| Previous | `ArrowLeft` | `ArrowUp` |
| First | `Home` | `Home` |
| Last | `End` | `End` |

### Usage

```tsx
import { useRovingFocus } from "@/web/hooks/use-roving-focus";

function Toolbar() {
  const { getRovingProps } = useRovingFocus({ orientation: "horizontal" });
  const items = ["Bold", "Italic", "Underline"];

  return (
    <div role="toolbar" aria-label="Text formatting">
      {items.map((label, i) => (
        <button key={label} {...getRovingProps(i)}>
          {label}
        </button>
      ))}
    </div>
  );
}
```

---

## useFileUpload

Manages file upload state, client-side validation, and API submission. Used by [`AvatarUpload`](avatar-upload.md) and available for custom upload UIs.

**Source:** `src/web/hooks/use-file-upload.ts`

### Return Value

| Property | Type | Description |
| --- | --- | --- |
| `state` | `"idle" \| "uploading" \| "success" \| "error"` | Current upload state. |
| `error` | `string \| null` | Error message from the last failed upload. |
| `data` | `T \| null` | Response data from a successful upload. |
| `upload` | `(file: File, options: UploadOptions) => Promise<T \| null>` | Sends the file to the API. |
| `cancel` | `() => void` | Aborts the in-flight upload. |
| `validate` | `(file: File, constraints: FileConstraints) => ValidationError \| null` | Client-side validation before uploading. |
| `reset` | `() => void` | Resets state to idle and aborts any in-flight upload. |

### UploadOptions

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `endpoint` | `string` | -- | API endpoint to upload to. |
| `method` | `"post" \| "put"` | `"put"` | HTTP method. |
| `fieldName` | `string` | `"file"` | FormData field name. |

### FileConstraints

| Option | Type | Description |
| --- | --- | --- |
| `accept` | `readonly string[]` | Accepted MIME types. Empty or undefined allows all. |
| `maxSize` | `number` | Maximum file size in bytes. |

### Usage

```tsx
import { useFileUpload } from "@/web/hooks/use-file-upload";

function UploadButton() {
  const { state, upload, validate, error } = useFileUpload<{ upload: { url: string } }>();

  const handleFile = async (file: File) => {
    const err = validate(file, { accept: ["image/png"], maxSize: 2 * 1024 * 1024 });
    if (err) return alert(err.message);
    await upload(file, { endpoint: "/api/users/me/avatar", method: "put" });
  };

  return <div>{state === "uploading" ? "Uploading..." : "Ready"}</div>;
}
```

---

## useDocumentTitle

Sets the document title while the component is mounted, appending the app name suffix. Restores the previous title on unmount.

**Source:** `src/web/hooks/use-document-title.ts`

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `title` | `string` | The page title. Rendered as `"<title> \| AI Site Starter"`. Pass an empty string for the base title only. |

### Usage

```tsx
import { useDocumentTitle } from "@/web/hooks/use-document-title";

function SettingsPage() {
  useDocumentTitle("Settings");
  // document.title is now "Settings | AI Site Starter"
  return <div>...</div>;
}
```

---

## useForceDefaultTheme

Forces the default (Minimal) theme while the component is mounted by removing the `data-theme` attribute from the document element. Restores the previous theme on unmount so workspace pages transition smoothly. Does not touch localStorage — the cached theme remains available for the FOUC prevention script on authenticated page loads.

Used by `Landing` and `AuthLayout` to ensure public-facing pages always render with the default theme regardless of the user's saved preference.

**Source:** `src/web/hooks/use-force-default-theme.ts`

### Usage

```tsx
import { useForceDefaultTheme } from "@/web/hooks/use-force-default-theme";

function AuthLayout({ children }: { children: ReactNode }) {
  useForceDefaultTheme();
  return <div className="auth-layout">{children}</div>;
}
```

---

## usePrefersReducedMotion

Returns `true` when the user has `prefers-reduced-motion: reduce` enabled in their OS or browser settings. Used by animation components to skip animations.

**Source:** `src/web/hooks/use-reduced-motion.ts`

### Return Value

`boolean` — `true` if reduced motion is preferred, `false` otherwise.

### Behavior

- Uses `useSyncExternalStore` to subscribe to the `(prefers-reduced-motion: reduce)` media query.
- Returns `false` on the server (SSR-safe).

### Usage

```tsx
import { usePrefersReducedMotion } from "@/web/hooks/use-reduced-motion";

function AnimatedWidget() {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <div style={{ transition: reducedMotion ? "none" : "transform 0.3s" }}>
      Content
    </div>
  );
}
```

---

## useApi

A data-fetching hook that performs a GET request to the given API path, tracks loading/error/data state, and supports refetching.

**Source:** `src/web/hooks/use-api.ts`

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `path` | `string` | The API endpoint path (e.g., `"/api/users/me"`). |

### Return Value

| Property | Type | Description |
| --- | --- | --- |
| `data` | `T \| null` | The response data on success. |
| `error` | `string \| null` | Error message on failure. |
| `loading` | `boolean` | `true` while the request is in flight. |
| `refetch` | `() => void` | Triggers a fresh request. |

### Behavior

- Aborts in-flight requests on unmount or when `path` changes.
- Extracts error messages from `ApiError` instances.

### Usage

```tsx
import { useApi } from "@/web/hooks/use-api";

function UserProfile() {
  const { data, loading, error, refetch } = useApi<{ name: string }>("/api/users/me");

  if (loading) return <Spinner />;
  if (error) return <Alert variant="error">{error}</Alert>;
  return <Text>{data?.name}</Text>;
}
```

---

## useTheme

Provides access to the current theme and the ability to switch themes. Reads from the `data-theme` attribute on `<html>` and persists the choice to localStorage.

**Source:** `src/web/hooks/use-theme.ts`

### Return Value

| Property | Type | Description |
| --- | --- | --- |
| `theme` | `Theme` | The current theme name (`"default"`, `"events"`, `"grimdark"`, or `"tech"`). |
| `setTheme` | `(theme: Theme) => void` | Sets the active theme. |
| `themes` | `readonly Theme[]` | Array of all available theme names. |

### Behavior

- Uses `useSyncExternalStore` with a `MutationObserver` to react to `data-theme` attribute changes.
- Setting `"default"` removes the `data-theme` attribute and clears localStorage.
- Other themes set the attribute and persist to localStorage under the key `"theme"`.
- Gracefully handles private browsing mode (localStorage may throw).
- The initial theme is restored before React mounts via a blocking inline `<script>` in `src/web/index.html` (not by this hook). The hook reads the already-applied `data-theme` attribute on first render. See the [FOUC prevention](../design-system/theming.md#fouc-prevention) section in the theming docs.

### Usage

```tsx
import { useTheme } from "@/web/hooks/use-theme";

function ThemePicker() {
  const { theme, setTheme, themes } = useTheme();
  return (
    <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
      {themes.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );
}
```

---

## useDebounce

Returns a debounced version of a value that only updates after a specified delay of inactivity. Useful for search inputs, API queries, and any scenario where you want to wait for the user to stop typing.

**Source:** `src/web/hooks/use-debounce.ts`

### Parameters

| Parameter | Type     | Default | Description                                       |
| --------- | -------- | ------- | ------------------------------------------------- |
| `value`   | `T`      | --      | The value to debounce.                            |
| `delayMs` | `number` | `300`   | Delay in milliseconds. Pass `0` to bypass debounce. |

### Return Value

`T` — The debounced value.

### Behavior

- Uses `useEffect` + `setTimeout` internally.
- Cleans up timeouts on unmount and when the value changes.
- When `delayMs` is `0`, updates immediately (no debounce).

### Usage

```tsx
import { useEffect, useState } from "react";
import { useDebounce } from "@/web/hooks/use-debounce";

function SearchResults() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    // Only fires 300ms after user stops typing
    fetchResults(debouncedQuery);
  }, [debouncedQuery]);

  return <input value={query} onChange={(e) => setQuery(e.target.value)} />;
}
```

---

## useMutation

A mutation hook for non-GET requests (POST, PUT, PATCH, DELETE). Complements `useApi` by handling write operations with loading/error state tracking.

**Source:** `src/web/hooks/use-mutation.ts`

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `method` | `"post" \| "patch" \| "put" \| "delete"` | The HTTP method to use. |
| `path` | `string \| ((input: TInput) => string)` | The API endpoint path. Can be a static string or a function that receives the input and returns the path (useful for paths that depend on input data, e.g., including an ID). |

### Return Value

| Property | Type | Description |
| --- | --- | --- |
| `mutate` | `(input: TInput) => Promise<TResult>` | Sends the request. Resolves with the response data on success, throws on failure. |
| `loading` | `boolean` | `true` while the request is in flight. |
| `error` | `string \| null` | Error message from the last failed request. |
| `reset` | `() => void` | Resets state back to idle and clears any error. |

### Behavior

- Uses `useReducer` to manage an `"idle" | "loading" | "success" | "error"` state machine.
- For `delete` requests, the input is not sent as a body; for `post`, `patch`, and `put`, the input is sent as the request body.
- The `path` parameter accepts a function, allowing dynamic URL construction from the input (e.g., `(input) => \`/api/tasks/${input.id}\``).
- Extracts error messages from `ApiError` instances; falls back to `"An error occurred"` for unknown errors.
- Re-throws the original error after dispatching, so callers can handle it in `.catch()` or `try/catch`.

### Usage

```tsx
import { useMutation } from "@/web/hooks/use-mutation";

interface CreateTask {
  title: string;
  projectId: string;
}

interface Task {
  id: string;
  title: string;
}

function NewTaskForm({ projectId }: { projectId: string }) {
  const { mutate, loading, error } = useMutation<CreateTask, Task>(
    "post",
    "/api/tasks",
  );

  const handleSubmit = async (title: string) => {
    try {
      const task = await mutate({ title, projectId });
      console.log("Created:", task.id);
    } catch {
      // error state is already set by the hook
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit("New task"); }}>
      {error && <Alert variant="error">{error}</Alert>}
      <button type="submit" disabled={loading}>
        {loading ? "Creating..." : "Create Task"}
      </button>
    </form>
  );
}
```

---

## useDeferredDelete

Manages deferred deletions with undo support. Items are optimistically removed from the UI immediately, but the actual API call is delayed by 5 seconds. During that window the user can undo, which cancels the API call and restores the item.

**Source:** `src/web/hooks/use-deferred-delete.ts`

### Options

| Option | Type | Description |
| --- | --- | --- |
| `onDelete` | `(id: string, item: T) => Promise<void>` | Executes the actual delete API call after the delay expires. |
| `onError` | `(id: string) => void` | Called when the API call fails. |
| `onToast` | `(message: string, undoFn: () => void) => void` | Shows an undo toast. Call `undoFn` to cancel the pending deletion and trigger `onRestore`. |

### Return Value

| Property | Type | Description |
| --- | --- | --- |
| `schedule` | `(id: string, item: T, toastMessage: string, onRestore: (item: T) => void) => void` | Schedules a deferred deletion. The item is expected to be removed from the UI immediately by the caller. |

### Behavior

- The undo window is **5 seconds** (`UNDO_DELAY_MS`).
- If `schedule` is called again for the same `id` before the timer fires (rapid delete/undo/delete), the previous timer is cancelled and a new one starts.
- All pending timeouts are cleaned up on component unmount.
- Pairs naturally with the `Toast` component's `action` prop to display an "Undo" button.

### Usage

```tsx
import { useDeferredDelete } from "@/web/hooks/use-deferred-delete";
import { useToast } from "@/web/components/ui/ToastContext";

function MemberList() {
  const { toast } = useToast();
  const [members, setMembers] = useState(initialMembers);

  const { schedule } = useDeferredDelete<Member>({
    onDelete: (id) => api.delete(`/api/members/${id}`),
    onError: (id) => toast(`Failed to remove member`, { variant: "error" }),
    onToast: (message, undoFn) =>
      toast(message, { variant: "success", action: { label: "Undo", onClick: undoFn } }),
  });

  const handleRemove = (member: Member) => {
    setMembers((prev) => prev.filter((m) => m.id !== member.id));
    schedule(member.id, member, "Member removed.", (restored) =>
      setMembers((prev) => [...prev, restored]),
    );
  };

  return /* ... */;
}
```

---

## useHotkey

Registers a global keyboard shortcut on `document`. Automatically ignores key events originating from input elements (`<input>`, `<textarea>`, `<select>`, `contentEditable`).

**Source:** `src/web/hooks/use-hotkey.ts`

### Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `key` | `string` | -- | The key to listen for (matched case-insensitively against `e.key`). |
| `handler` | `() => void` | -- | Callback when the shortcut fires. |
| `options.ctrlOrMeta` | `boolean` | `false` | If `true`, requires Ctrl (Windows/Linux) or Cmd (Mac). |
| `options.enabled` | `boolean` | `true` | Pass `false` to temporarily disable the shortcut. |

### Behavior

- Listens on `keydown`.
- Calls `e.preventDefault()` before invoking `handler`.
- Skips events when the target is an input, textarea, select, or contentEditable element.

### Usage

```tsx
import { useHotkey } from "@/web/hooks/use-hotkey";

function App() {
  const [open, setOpen] = useState(false);
  useHotkey("k", () => setOpen(true), { ctrlOrMeta: true });
  useHotkey("?", () => setShortcutsOpen(true));

  return /* ... */;
}
```

---

## useHotkeyChord

Registers a two-key chord shortcut (e.g. press `g` then `d` to navigate to the Dashboard). After the first key is pressed, a 1-second window opens for the second key. If the timeout elapses or a non-matching key is pressed, the chord resets.

**Source:** `src/web/hooks/use-hotkey.ts`

### Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `firstKey` | `string` | -- | The prefix key that starts the chord. |
| `secondKey` | `string` | -- | The second key that completes the chord. |
| `handler` | `() => void` | -- | Callback when the full chord fires. |
| `options.enabled` | `boolean` | `true` | Pass `false` to disable. |

### Behavior

- Ignores events from input elements and when modifier keys (Ctrl/Cmd/Alt) are held.
- Uses module-level shared state (`currentChordPrefix`) so multiple `useHotkeyChord` registrations share the same chord prefix. The first matching `firstKey` press sets the prefix; the first matching `secondKey` completes the chord.
- The 1-second timeout and cleanup are handled per-hook instance.

### Usage

```tsx
import { useHotkeyChord } from "@/web/hooks/use-hotkey";

function WorkspaceLayout() {
  const navigate = useNavigate();
  useHotkeyChord("g", "d", () => navigate("/dashboard"));
  useHotkeyChord("g", "p", () => navigate("/projects"));
  return /* ... */;
}
```

---

## useChordIndicator

Subscribes to the shared chord prefix state managed by `useHotkeyChord`. Returns the currently active chord prefix (e.g. `"g"`) or `null`. Designed for rendering a visual indicator in the UI when a chord is in progress.

**Source:** `src/web/hooks/use-hotkey.ts`

### Return Value

`string | null` — The active chord prefix key, or `null` when no chord is in progress.

### Usage

```tsx
import { useChordIndicator } from "@/web/hooks/use-hotkey";

function Navbar() {
  const chordPrefix = useChordIndicator();
  return (
    <nav>
      {chordPrefix && <kbd className="chord-indicator">{chordPrefix}</kbd>}
    </nav>
  );
}
```

---

## useRecents

Tracks recently accessed items (projects, tasks) per workspace, persisted to localStorage. Used by the CommandPalette to show a "Recent" section.

**Source:** `src/web/hooks/use-recents.ts`

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `workspaceId` | `string` | The workspace ID. Items are stored under the localStorage key `cadence:recents:{workspaceId}`. |

### Return Value

| Property | Type | Description |
| --- | --- | --- |
| `recents` | `RecentItem[]` | Sorted by most recent first, capped at 10. |
| `addRecent` | `(item: Omit<RecentItem, "timestamp">) => void` | Adds or bumps an item to the top of the list. Deduplicates by `id` + `type`. |

### RecentItem

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Entity ID. |
| `name` | `string` | Display name. |
| `type` | `"project" \| "task"` | Item type. |
| `projectId` | `string?` | Parent project ID (for tasks). |
| `timestamp` | `number` | `Date.now()` when added. |

### Usage

```tsx
import { useRecents } from "@/web/hooks/use-recents";

function RecentsList({ workspaceId }: { workspaceId: string }) {
  const { recents, addRecent } = useRecents(workspaceId);

  return (
    <ul>
      {recents.map((r) => (
        <li key={r.id} onClick={() => addRecent({ id: r.id, name: r.name, type: r.type })}>
          {r.name}
        </li>
      ))}
    </ul>
  );
}
```

---

## useFavorites

Manages a list of favorite project IDs per workspace, persisted to localStorage. Used by the sidebar, command palette, and project list to let users star/unstar projects.

**Source:** `src/web/hooks/use-favorites.ts`

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `workspaceId` | `string` | The workspace ID. Favorites are stored under the localStorage key `cadence:favorites:{workspaceId}`. |

### Return Value

| Property | Type | Description |
| --- | --- | --- |
| `favorites` | `string[]` | Array of favorited project IDs. |
| `isFavorite` | `(projectId: string) => boolean` | Returns `true` if the project is favorited. |
| `toggleFavorite` | `(projectId: string) => void` | Adds or removes a project from favorites. |

### Behavior

- Reloads favorites from localStorage when `workspaceId` changes.
- Writes to localStorage on every toggle. Silently handles storage-full errors.

### Usage

```tsx
import { useFavorites } from "@/web/hooks/use-favorites";

function ProjectCard({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const { isFavorite, toggleFavorite } = useFavorites(workspaceId);

  return (
    <button onClick={() => toggleFavorite(projectId)}>
      {isFavorite(projectId) ? "★" : "☆"}
    </button>
  );
}
```

---

## useActiveSection

Tracks which section is currently visible in the viewport using `IntersectionObserver`. Returns the ID of the first visible section in document order. Useful for scroll-spy navigation, such as highlighting the active link in a table of contents.

**Source:** `src/web/hooks/use-active-section.ts`

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `sectionIds` | `string[]` | Array of DOM element IDs to observe. The order determines priority when multiple sections are visible. |

### Return Value

`string | null` — The `id` of the first visible section in the `sectionIds` order, or `null` if no sections are visible.

### Behavior

- Looks up each ID via `document.getElementById` and observes only elements that exist in the DOM.
- Uses an `IntersectionObserver` with `rootMargin: "-80px 0px -40% 0px"` to account for fixed headers and trigger slightly before the section reaches the center of the viewport.
- Maintains an internal `Set` of currently visible section IDs. On each intersection change, selects the first visible section according to the original `sectionIds` order.
- Re-creates the observer when the `sectionIds` array changes. Disconnects the observer on unmount.

### Usage

```tsx
import { useActiveSection } from "@/web/hooks/use-active-section";

const sectionIds = ["overview", "features", "pricing", "faq"];

function TableOfContents() {
  const activeId = useActiveSection(sectionIds);

  return (
    <nav>
      {sectionIds.map((id) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={activeId === id ? "true" : undefined}
          className={activeId === id ? "font-bold" : ""}
        >
          {id}
        </a>
      ))}
    </nav>
  );
}
```

---

## useFieldErrors

Manages per-field validation errors for forms that use Zod schemas. Extracts the duplicated `fieldErrors` state, `clearFieldError`, and Zod-error-to-record mapping that was previously copy-pasted across every form component.

**Source:** `src/web/hooks/use-field-errors.ts`

### Return Value

| Property | Type | Description |
| --- | --- | --- |
| `fieldErrors` | `Record<string, string>` | Map of field names to their current error messages. |
| `clearFieldError` | `(field: string) => void` | Removes the error for a specific field. Call on input change to clear errors as the user types. |
| `setFromZodError` | `(zodError: ZodError) => void` | Extracts field-level errors from a Zod validation failure and populates `fieldErrors`. Uses the first path segment as the field key. |
| `resetFieldErrors` | `() => void` | Clears all field errors at once. Call before re-validating on submit. |

### Usage Pattern

All form components follow the same pattern with this hook:

1. Call `resetFieldErrors()` at the start of submit
2. Run `schema.safeParse()` on the form data
3. If invalid, call `setFromZodError(result.error)` and return
4. If valid, proceed with the API call
5. On each input's `onChange`, call `clearFieldError(fieldName)` to clear that field's error as the user edits

### Usage

```tsx
import { useFieldErrors } from "@/web/hooks/use-field-errors";
import { FieldError } from "@/web/components/ui/Field";
import { loginSchema } from "@/shared/schemas/auth";

function LoginForm() {
  const { fieldErrors, clearFieldError, setFromZodError, resetFieldErrors } = useFieldErrors();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    resetFieldErrors();
    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      setFromZodError(result.error);
      return;
    }
    // proceed with API call
  };

  return (
    <form onSubmit={handleSubmit}>
      <Input
        value={email}
        onChange={(e) => { setEmail(e.target.value); clearFieldError("email"); }}
      />
      <FieldError>{fieldErrors.email}</FieldError>
      <Input
        type="password"
        value={password}
        onChange={(e) => { setPassword(e.target.value); clearFieldError("password"); }}
      />
      <FieldError>{fieldErrors.password}</FieldError>
      <Button type="submit">Sign in</Button>
    </form>
  );
}
```

---

## useTaskComments

Fetches paginated comments for a task using cursor-based infinite scrolling. Shared between `TaskDetailPanel` and `TaskDetailDialog` to avoid duplicating query setup, flattening logic, and pagination config.

**Source:** `src/web/hooks/use-task-comments.ts`

### Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `taskId` | `string` | -- | The task whose comments to fetch. |
| `options.enabled` | `boolean` | `true` | Pass `false` to disable the query (e.g., before the task has loaded). |

### Return Value

| Property | Type | Description |
| --- | --- | --- |
| `comments` | `Comment[]` | Flattened array of all loaded comments across pages. |
| `isLoading` | `boolean` | `true` while the initial page of comments is loading. |
| `isError` | `boolean` | `true` if the query failed. |
| `fetchNextPage` | `() => void` | Loads the next page of comments. |
| `hasNextPage` | `boolean` | `true` when there are more pages to load. |
| `isFetchingNextPage` | `boolean` | `true` while the next page is loading. |

### Behavior

- Uses `useInfiniteQuery` from `@tanstack/react-query` with `queryKeys.tasks.comments(taskId)`.
- Each page fetches 20 comments via `GET /api/tasks/:taskId/comments?limit=20&cursor=...`.
- Pages are flattened into a single `comments` array via `useMemo`.
- Exports the `CommentsPage` interface (`{ comments: Comment[]; nextCursor: string | null }`) for use by consumers that need the page type.

### Usage

```tsx
import { useTaskComments } from "@/web/hooks/use-task-comments";

function TaskComments({ taskId }: { taskId: string }) {
  const { comments, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useTaskComments(taskId);

  return (
    <div>
      {comments.map((c) => (
        <div key={c.id}>{c.body}</div>
      ))}
      {hasNextPage && (
        <button onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? "Loading..." : "Load more comments"}
        </button>
      )}
    </div>
  );
}
```

## useLabels

A family of React Query hooks for project label CRUD and task-label assignment. All hooks invalidate the relevant query caches on mutation.

**Source:** `src/web/hooks/use-labels.ts`

### Hooks

| Hook | Params | Description |
| --- | --- | --- |
| `useLabels(projectId, options?)` | `projectId: string`, `options?: { enabled?: boolean }` | Fetches all labels for a project via `GET /api/projects/:projectId/labels`. Returns `{ labels: Label[] }` (each label includes `taskCount`). |
| `useCreateLabel(projectId)` | `projectId: string` | Creates a label. Mutation input: `{ name: string; color: string }`. Also invalidates the tasks list (since tasks embed label info). |
| `useUpdateLabel(projectId)` | `projectId: string` | Updates a label. Mutation input: `{ labelId: string; name?: string; color?: string }`. Optimistic update on the labels list. |
| `useDeleteLabel(projectId)` | `projectId: string` | Deletes a label. Optimistic removal from the labels list. Also invalidates the tasks list (since tasks embed label info). |
| `useAssignLabel(taskId, projectId)` | `taskId: string, projectId: string` | Assigns a label to a task. Mutation input: `labelId: string`. Optimistic update on task detail, task list, and label `taskCount`; rolls back on error. |
| `useUnassignLabel(taskId, projectId)` | `taskId: string, projectId: string` | Removes a label from a task. Mutation input: `labelId: string`. Optimistic update on task detail, task list, and label `taskCount`; rolls back on error. |

### Label Type

```ts
interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
  taskCount: number;
  createdAt: string;
}
```

### Usage

```tsx
import { useLabels, useAssignLabel } from "@/web/hooks/use-labels";

function TaskLabels({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { data } = useLabels(projectId);
  const assign = useAssignLabel(taskId, projectId);

  return (
    <div>
      {data?.labels.map((label) => (
        <button key={label.id} onClick={() => assign.mutate(label.id)}>
          {label.name}
        </button>
      ))}
    </div>
  );
}
```

## useTaskAttachments

React Query hook for fetching task attachments, with companion cache-manipulation functions for optimistic updates.

**Source:** `src/web/hooks/use-task-attachments.ts`

### Hook

| Hook | Params | Description |
| --- | --- | --- |
| `useTaskAttachments(taskId, options?)` | `taskId: string`, `options?: { enabled?: boolean }` | Fetches attachments via `GET /api/tasks/:taskId/attachments`. Returns `{ attachments: Attachment[], isLoading, isError }`. |

### Optimistic Cache Helpers

| Function | Description |
| --- | --- |
| `optimisticAddAttachment(qc, taskId, attachment)` | Appends an attachment to the React Query cache. |
| `rollbackAddAttachment(qc, taskId, optimisticId)` | Removes an optimistic attachment from cache (upload rollback). |
| `optimisticRemoveAttachment(qc, taskId, attachmentId)` | Removes an attachment from cache, returns the removed item for rollback. |
| `rollbackRemoveAttachment(qc, taskId, attachment)` | Re-inserts a removed attachment in chronological order (delete rollback). |

### Attachment Type

```ts
interface Attachment {
  id: string;
  uploadId: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  uploaderName: string | null;
  uploaderImage: string | null;
  createdAt: string;
}
```

### Usage

```tsx
import { useTaskAttachments } from "@/web/hooks/use-task-attachments";

function Attachments({ taskId }: { taskId: string }) {
  const { attachments, isLoading } = useTaskAttachments(taskId);

  if (isLoading) return <Spinner />;
  return <div>{attachments.map((a) => <span key={a.id}>{a.filename}</span>)}</div>;
}
```

## useProjectDashboard

React Query hook for fetching the project dashboard data including task counts, group breakdowns, member workloads, upcoming tasks, overdue tasks, priority breakdown, cost aggregation, budget, and cost per member.

**Source:** `src/web/hooks/use-project-dashboard.ts`

### Hook

| Hook | Params | Description |
| --- | --- | --- |
| `useProjectDashboard(projectId)` | `projectId: string` | Fetches dashboard data via `GET /api/projects/:projectId/dashboard`. Stale time: 30 s. |

### Return Type

Returns a standard `useQuery` result where `data` is `ProjectDashboardData`:

| Field | Type | Description |
| --- | --- | --- |
| `taskCounts` | `{ activeCount, completedCount, totalCount }` | Aggregate task counts for the project. |
| `tasksByGroup` | `Array<{ taskGroupId, taskGroupName, count }>` | Task count per task group. |
| `tasksPerMember` | `Array<{ id, name, count }>` | Task count per assigned member. |
| `upcomingTasks` | `Array<{ id, title, completed, priority, dueDate, assigneeId, taskGroupId, taskGroupName }>` | Tasks due within the next 30 days. |
| `overdueTasks` | `OverdueTask[]` | Past-due incomplete tasks with assignee details (`assigneeName`, `assigneeImage`). |
| `priorityBreakdown` | `PriorityCount[]` | Count of active tasks by priority level (`{ priority, count }`). |
| `costAggregation` | `CostAggregation` | Task cost totals: `totalCost`, `completedCost`, `activeCost`, `tasksWithCost` (all in cents). |
| `budget` | `number \| null` | Project budget in cents, or `null` if unset. |
| `costPerMember` | `Array<{ id, name, totalCost }>` | Total cost of assigned tasks per member (only members with costed tasks). |

### Usage

```tsx
import { useProjectDashboard } from "@/web/hooks/use-project-dashboard";

function DashboardStats({ projectId }: { projectId: string }) {
  const { data, isLoading } = useProjectDashboard(projectId);

  if (isLoading) return <Spinner />;
  return <div>Active: {data?.taskCounts.activeCount}</div>;
}
```

## useProjectActivity

React Query infinite-scroll hook for fetching a paginated activity feed across all tasks in a project.

**Source:** `src/web/hooks/use-project-activity.ts`

### Hook

| Hook | Params | Description |
| --- | --- | --- |
| `useProjectActivity(projectId)` | `projectId: string` | Fetches activities via `GET /api/projects/:projectId/activity` with cursor pagination (15 items per page). |

### Return Type

Returns a standard `useInfiniteQuery` result. Each page contains:

| Field | Type | Description |
| --- | --- | --- |
| `activities` | `ProjectActivityItem[]` | Activity entries with `id`, `taskId`, `taskTitle`, `actorId`, `actorName`, `actorImage`, `action`, `field`, `oldValue`, `newValue`, `createdAt`. |
| `nextCursor` | `string \| null` | Cursor for the next page, or `null` when no more pages. |

### Usage

```tsx
import { useProjectActivity } from "@/web/hooks/use-project-activity";

function ActivityFeed({ projectId }: { projectId: string }) {
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage } = useProjectActivity(projectId);
  const activities = data?.pages.flatMap((p) => p.activities) ?? [];

  return (
    <div>
      {activities.map((a) => (
        <div key={a.id}>{a.actorName} {a.action} on {a.taskTitle}</div>
      ))}
      {hasNextPage && (
        <button onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
```

## useMultiSelect

Shared multi-select state management for task views (ProjectBoard and ProjectTimeline). Encapsulates the selected-ID set, toggle behaviour, and Escape-key clearing so each view doesn't reimplement identical logic.

**Source:** `src/web/hooks/use-multi-select.ts`

### Return Value

| Field | Type | Description |
| --- | --- | --- |
| `selectedIds` | `Set<string>` | Currently selected task IDs. |
| `handleToggleSelect` | `(taskId: string, e?: MouseEvent) => void` | Toggle a task in/out of the selection. Optional `MouseEvent` calls `preventDefault()` (board cards need this to stop the click from opening the detail panel). |
| `handleClearSelection` | `() => void` | Clear all selected IDs. |

### Behaviour

- Pressing **Escape** automatically clears the selection when at least one item is selected.
- The listener is only attached while `selectedIds.size > 0`.

### Usage

```tsx
import { useMultiSelect } from "@/web/hooks/use-multi-select";

function BoardView() {
  const { selectedIds, handleToggleSelect, handleClearSelection } = useMultiSelect();

  return tasks.map((t) => (
    <TaskCard
      key={t.id}
      selected={selectedIds.has(t.id)}
      onToggleSelect={(e) => handleToggleSelect(t.id, e)}
    />
  ));
}
```

## useTaskCover

Encapsulates cover image upload, removal, and position-change logic for a task's detail panel. Mirrors the pattern established by `useProjectCover` but is task-specific: upload goes to `/api/tasks/:id/cover`, position changes persist through the task patch mutation, and removals optimistically clear the cover then rollback on failure.

**Source:** `src/web/hooks/use-task-cover.ts`

### Options

| Option | Type | Description |
| --- | --- | --- |
| `taskId` | `string` | The task to manage cover images for. |
| `setLocalTask` | `Dispatch<SetStateAction<TaskDetail \| null>>` | Local state setter for optimistic updates. |
| `updateTaskInContext` | `(taskId: string, updates: Partial<Task>) => void` | Board/list context updater. |
| `invalidateTaskQueries` | `() => void` | Cache invalidation callback. |
| `patchTaskMutateAsync` | `(updates: Partial<TaskDetail>) => Promise<unknown>` | Mutation function for position changes. |
| `toast` | `(message: string, options?) => string` | Toast notification function. |
| `refetch` | `() => Promise<unknown>` | Refetch task data on failure (rollback). |

### Return Value

| Field | Type | Description |
| --- | --- | --- |
| `coverUploading` | `boolean` | Whether a cover upload is in progress. |
| `handleCoverUpload` | `(file: File) => Promise<void>` | Upload a new cover image. |
| `handleCoverRemove` | `() => Promise<void>` | Optimistically remove the cover image with rollback on failure. |
| `handleCoverPositionChange` | `(pos: number) => Promise<void>` | Update the cover image vertical focal-point position. |

### Usage

```tsx
import { useTaskCover } from "@/web/hooks/use-task-cover";

function TaskDetailPanel({ taskId }) {
  const { coverUploading, handleCoverUpload, handleCoverRemove, handleCoverPositionChange } =
    useTaskCover({ taskId, setLocalTask, updateTaskInContext, invalidateTaskQueries, patchTaskMutateAsync, toast, refetch });

  return (
    <>
      <CoverImage onUpload={handleCoverUpload} onRemove={handleCoverRemove} onPositionChange={handleCoverPositionChange} uploading={coverUploading} />
    </>
  );
}
```

## useTaskEditing

Manages the editable fields (title, description, cost) of a task detail panel, including dirty-field tracking to prevent server refetches from clobbering in-progress user input. While a field is dirty (focused), incoming server data for that field is ignored, preserving unsaved edits.

**Source:** `src/web/hooks/use-task-editing.ts`

### Options

| Option | Type | Description |
| --- | --- | --- |
| `taskId` | `string` | The task being edited. |
| `localTask` | `TaskDetail \| null` | Current local task state. |
| `setLocalTask` | `Dispatch<SetStateAction<TaskDetail \| null>>` | Local state setter. |
| `updateTaskInContext` | `(taskId: string, updates: Partial<Task>) => void` | Board/list context updater. |
| `patchTaskMutateAsync` | `(updates: Partial<TaskDetail>) => Promise<unknown>` | Mutation function. |
| `toast` | `(message: string, options?) => string` | Toast notification function. |
| `refetch` | `() => Promise<unknown>` | Refetch on failure. |
| `taskData` | `{ task: TaskDetail } \| undefined` | Server query data for syncing editable fields. |

### Return Value

| Field | Type | Description |
| --- | --- | --- |
| `dirtyFields` | `MutableRefObject<Set<string>>` | Ref tracking which fields the user is actively editing. |
| `editingTitle` | `boolean` | Whether the title is in inline-edit mode. |
| `setEditingTitle` | `(editing: boolean) => void` | Toggle title editing. |
| `titleValue` | `string` | Current title input value. |
| `setTitleValue` | `(value: string) => void` | Update title input. |
| `descriptionValue` | `string` | Current description input value. |
| `setDescriptionValue` | `(value: string) => void` | Update description input. |
| `costDisplay` | `string` | Current cost display string (dollars, e.g. "12.50"). |
| `setCostDisplay` | `(value: string) => void` | Update cost display. |
| `handlePatch` | `(updates: Partial<TaskDetail>) => Promise<void>` | Generic optimistic patch with rollback. |
| `handleTitleSave` | `() => Promise<void>` | Save title on blur/enter, clears dirty flag. |
| `handleDescriptionBlur` | `() => Promise<void>` | Save description on blur, clears dirty flag. |
| `handleCostBlur` | `() => Promise<void>` | Parse and save cost on blur (cents conversion), clears dirty flag. |

### Dirty-Field Pattern

Fields are marked dirty on focus and cleared on blur/save. While dirty, incoming server data for that field is ignored via the `useEffect` sync:

```tsx
if (!dirtyFields.current.has("title")) setTitleValue(t.title);
if (!dirtyFields.current.has("description")) setDescriptionValue(t.description ?? "");
if (!dirtyFields.current.has("cost")) setCostDisplay(...);
```

### Usage

```tsx
import { useTaskEditing } from "@/web/hooks/use-task-editing";

function TaskDetailPanel({ taskId, taskData }) {
  const editing = useTaskEditing({ taskId, localTask, setLocalTask, updateTaskInContext, patchTaskMutateAsync, toast, refetch, taskData });

  return (
    <input
      value={editing.titleValue}
      onChange={(e) => editing.setTitleValue(e.target.value)}
      onFocus={() => editing.dirtyFields.current.add("title")}
      onBlur={editing.handleTitleSave}
    />
  );
}
```

## useTaskSubtasks

Encapsulates all subtask state and handlers for the task detail panel: DnD sensors, sorted subtask memos, active drag state, and CRUD operations (add, delete, rename, toggle, reorder) with optimistic updates and rollback.

**Source:** `src/web/hooks/use-task-subtasks.ts`

### Options

| Option | Type | Description |
| --- | --- | --- |
| `taskId` | `string` | Parent task ID. |
| `localTask` | `TaskDetail \| null` | Current local task state. |
| `setLocalTask` | `Dispatch<SetStateAction<TaskDetail \| null>>` | Local state setter. |
| `updateTaskInContext` | `(taskId: string, updates: Partial<Task>) => void` | Board/list context updater (subtask counts). |
| `invalidateTaskQueries` | `() => void` | Cache invalidation callback. |
| `toast` | `(message: string, options?) => string` | Toast notification function. |
| `createSubtask` | `UseMutationResult<{ subtask: Subtask }, Error, { title: string }>` | React Query mutation for creating subtasks. |

### Return Value

| Field | Type | Description |
| --- | --- | --- |
| `subtaskSensors` | `SensorDescriptor[]` | DnD kit sensor config (PointerSensor with 5px activation distance). |
| `sortedSubtasks` | `Subtask[]` | Subtasks sorted by fractional-index position. |
| `subtaskIds` | `string[]` | Sorted subtask IDs (for SortableContext). |
| `activeSubtask` | `Subtask \| null` | Currently dragged subtask (for DragOverlay). |
| `newSubtaskTitle` | `string` | Controlled input value for the add-subtask field. |
| `setNewSubtaskTitle` | `(title: string) => void` | Update the add-subtask input. |
| `handleSubtaskToggle` | `(subtask: Subtask) => Promise<void>` | Toggle completed state with optimistic update and board-card count sync. |
| `handleAddSubtask` | `() => Promise<void>` | Create subtask with optimistic insertion at end, fractional-index positioning, and rollback. |
| `handleDeleteSubtask` | `(subtaskId: string) => Promise<void>` | Delete subtask with optimistic removal and count sync. |
| `handleRenameSubtask` | `(subtaskId: string, title: string) => Promise<void>` | Rename subtask with optimistic update. |
| `handleSubtaskDragStart` | `(event: DragStartEvent) => void` | Set active drag state. |
| `handleSubtaskDragEnd` | `(event: DragEndEvent) => Promise<void>` | Reorder via fractional-index with optimistic update. |

### Usage

```tsx
import { useTaskSubtasks } from "@/web/hooks/use-task-subtasks";

function SubtaskSection({ taskId, localTask, setLocalTask, ... }) {
  const sub = useTaskSubtasks({ taskId, localTask, setLocalTask, updateTaskInContext, invalidateTaskQueries, toast, createSubtask });

  return (
    <DndContext sensors={sub.subtaskSensors} onDragStart={sub.handleSubtaskDragStart} onDragEnd={sub.handleSubtaskDragEnd}>
      <SortableContext items={sub.subtaskIds} strategy={verticalListSortingStrategy}>
        {sub.sortedSubtasks.map((s) => (
          <SortableSubtaskRow key={s.id} subtask={s} onToggle={() => sub.handleSubtaskToggle(s)} onDelete={() => sub.handleDeleteSubtask(s.id)} />
        ))}
      </SortableContext>
      <DragOverlay>{sub.activeSubtask && <SubtaskRow subtask={sub.activeSubtask} />}</DragOverlay>
    </DndContext>
  );
}
```

## useTaskActions

Centralised optimistic-update handlers for task mutations used across ProjectBoard (TaskCard) and ProjectTimeline (TimelineTaskRow). Handles API calls, rollback on failure, and toast error messages.

**Source:** `src/web/hooks/use-task-actions.ts`

### Options

| Option | Type | Description |
| --- | --- | --- |
| `task` | `Pick<Task, "id" \| "priority" \| "assigneeId" \| "assigneeName" \| "taskGroupId" \| "completed" \| "dueDate"> & { position?: string }` | The task to act on. `position` is optional (only board cards have it for move revert). |
| `updateTask` | `(taskId: string, updates: Partial<Task>) => void` | Optimistic context updater (from ProjectContext). |
| `removeTask` | `(taskId: string) => void` | Optimistic context remover (from ProjectContext). |
| `taskGroups` | `TaskGroup[]` | Available task groups for move-to-group logic. |
| `workspaceId` | `string` | Workspace ID — needed to invalidate dashboard queries on delete. |

### Return Value

| Field | Type | Description |
| --- | --- | --- |
| `handlePriorityChange` | `(priority: TaskPriority) => Promise<void>` | Update priority with optimistic rollback. |
| `handleAssigneeChange` | `(assigneeId: string \| null, assigneeName?: string) => Promise<void>` | Update assignee with optimistic rollback. |
| `handleMoveToGroup` | `(targetGroupId: string) => Promise<void>` | Move task between groups (no-op if same group). Optimistically sets `completed` based on the target group's `isCompletionGroup` flag. |
| `handleDueDateChange` | `(date: string \| null) => Promise<void>` | Update due date with optimistic rollback. |
| `handleDeleteConfirm` | `() => Promise<void>` | Delete task and remove from context. Invalidates task detail and workspace dashboard queries. |
| `deleting` | `boolean` | Whether a delete request is currently in flight. |
| `showDeleteDialog` | `boolean` | Delete confirmation dialog open state. |
| `setShowDeleteDialog` | `(open: boolean) => void` | Control the delete confirmation dialog. |

### Usage

```tsx
import { useTaskActions } from "@/web/hooks/use-task-actions";

function TaskCard({ task, updateTask, removeTask, taskGroups, workspaceId }) {
  const actions = useTaskActions({ task, updateTask, removeTask, taskGroups, workspaceId });

  return (
    <>
      <PriorityDropdown onChange={actions.handlePriorityChange} />
      <ConfirmDialog
        open={actions.showDeleteDialog}
        onConfirm={actions.handleDeleteConfirm}
        loading={actions.deleting}
      />
    </>
  );
}
```

## useTaskCommentActions

Encapsulates comment CRUD mutations, local editing state, and optimistic update/rollback logic for task detail views. Shared between `TaskDetailDialog` and `TaskDetailPanelInner` to eliminate duplicated comment management code. Uses the cache helpers from `useTaskComments` for optimistic cache manipulation.

**Source:** `src/web/hooks/use-task-comment-actions.ts`

### Options

| Option | Type | Description |
| --- | --- | --- |
| `taskId` | `string` | The task whose comments to manage. |
| `currentUserId` | `string \| undefined` | Current user's ID (for optimistic comment authorship). |
| `currentUserName` | `string \| undefined` | Current user's name (for optimistic comment display). |
| `invalidateTaskQueries` | `() => void` | Callback to invalidate relevant React Query caches after mutations settle. |
| `toast` | `(message: string, options?) => string` | Toast notification function. |
| `updateTaskInContext` | `(taskId: string, updates: Partial<Task>) => void` | Optional context updater for comment count on board task cards. The Panel passes `updateTaskInContext`; the Dialog omits it. |
| `commentCount` | `number` | Current comment count from `localTask`, used for optimistic count updates. |

### Return Value

| Field | Type | Description |
| --- | --- | --- |
| `commentBody` | `string` | Current new-comment textarea value. |
| `setCommentBody` | `(body: string) => void` | Setter for the new-comment textarea. |
| `editingCommentId` | `string \| null` | ID of the comment currently being edited, or `null`. |
| `setEditingCommentId` | `(id: string \| null) => void` | Enter/exit edit mode for a comment. |
| `editingCommentBody` | `string` | Current body text of the comment being edited. |
| `setEditingCommentBody` | `(body: string) => void` | Setter for the editing comment body. |
| `handleAddComment` | `() => Promise<void>` | Create a comment with optimistic cache insertion and rollback on failure. |
| `handleUpdateComment` | `(commentId: string) => Promise<void>` | Update a comment body with optimistic cache update and rollback on failure. |
| `handleDeleteComment` | `(commentId: string) => Promise<void>` | Delete a comment with optimistic removal and rollback on failure. |
| `resetCommentState` | `() => void` | Clears all local comment editing state (useful on dialog/panel open). |
| `isAddingComment` | `boolean` | Whether a create-comment mutation is in flight. |

## useTaskDetailActions

Encapsulates task-level actions (complete/uncomplete, duplicate, delete) and the delete confirmation dialog state. Shared between `TaskDetailDialog` and `TaskDetailPanelInner`. The two consumers differ in post-success behavior (Dialog closes; Panel clears URL), handled via the `onDeleteSuccess` callback and optional context updaters.

**Source:** `src/web/hooks/use-task-detail-actions.ts`

### Options

| Option | Type | Description |
| --- | --- | --- |
| `taskId` | `string` | The task to act on. |
| `localTask` | `TaskDetail \| null` | Local optimistic task state. |
| `setLocalTask` | `Dispatch<SetStateAction<TaskDetail \| null>>` | Setter for `localTask`. |
| `toast` | `(message: string, options?) => string` | Toast notification function. |
| `workspaceId` | `string` | Workspace ID for dashboard cache invalidation. |
| `projectId` | `string \| undefined` | Project ID for project-scoped cache invalidation (Dialog may not have one). |
| `onDeleteSuccess` | `() => void` | Called after successful deletion (Dialog closes; Panel clears URL param). |
| `updateTaskInContext` | `(taskId: string, updates: Partial<Task>) => void` | Optional: update task in board context (Panel has ProjectContext, Dialog doesn't). |
| `addTaskToContext` | `(task: Task) => void` | Optional: add task to board context (for duplicate or recurring task creation). |
| `removeTaskFromContext` | `(taskId: string) => void` | Optional: remove task from board context on delete. |
| `refetchTasks` | `() => void` | Optional: refetch the project task list after duplication. |

### Return Value

| Field | Type | Description |
| --- | --- | --- |
| `showDeleteDialog` | `boolean` | Delete confirmation dialog open state. |
| `setShowDeleteDialog` | `(open: boolean) => void` | Control the delete confirmation dialog. |
| `handleToggleComplete` | `() => Promise<void>` | Toggle task completion with optimistic update. Also handles recurring-task next-occurrence creation. |
| `handleDuplicateTask` | `() => Promise<void>` | Duplicate the task and add to context/refetch. |
| `handleDeleteTask` | `() => Promise<void>` | Delete the task, cancel in-flight queries, remove from context. |
| `isDeleting` | `boolean` | Whether a delete request is in flight. |

## useWorkspaceWebhooks

Centralises all state, queries, mutations, and handler functions for the workspace webhooks settings page. View components (`WebhookListView`, `WebhookDetailView`) receive slices of this hook's return value as props, keeping them stateless and presentational.

**Source:** `src/web/hooks/use-workspace-webhooks.ts`

### Return Value

The hook returns a large object grouped into logical sections:

**Context** — `workspace`, `projects`, `activeProjects`, `canManageWorkspace`

**View state** — `selectedWebhookId`, `handleSelectWebhook`, `createDialogOpen`, `editDialogOpen`, `deleteTarget`, `setDeleteTarget`

**Form state** — `createForm` and `editForm` objects, each containing `name`, `url`, `events`, `projectId`, `active`, `secret`, and a `reset()` method.

**Test state** — `testResult`, `testingId`

**Queries** — `webhooks`, `listLoading`, `listError`, `detailWebhook`, `deliveries`, `detailLoading`

**Mutations** — `createMutation`, `updateMutation`, `deleteMutation`

**Handlers** — `handleOpenCreate`, `handleCloseCreate`, `handleCreate`, `handleOpenEdit`, `handleCloseEdit`, `handleUpdate`, `handleRegenerateSecret`, `handleTest`, `handleCopiedSecret`

### Exports

| Export | Description |
| --- | --- |
| `WebhookRow` | Interface matching the webhook API response shape. |
| `projectName(projects, projectId)` | Look up a project name by ID from the projects list. |
| `parseEvents(raw)` | Parse a JSON-stringified event array into `WebhookEventType[]`. |
| `UseWorkspaceWebhooksReturn` | The full return type of `useWorkspaceWebhooks`. |

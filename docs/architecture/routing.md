# Frontend Routing

### Lazy Loading

All page components are loaded lazily using React's `lazy()` and `Suspense`:

```tsx
const Dashboard = lazy(() => import("./pages/Dashboard/Dashboard"));
const Login = lazy(() => import("./pages/Login/Login"));
// ... etc
```

This means each page is a separate JavaScript chunk that is only downloaded when the user navigates to that route. During loading, a full-screen spinner is shown:

```tsx
<Suspense
  fallback={
    <Center className="min-h-screen">
      <Spinner size="lg" />
    </Center>
  }
>
  <Routes>...</Routes>
</Suspense>
```

### Route Guards

Routes are protected using guard components that wrap page components:

- **`AuthGuard`** -- requires an active session. If no session exists, redirects to `/login`. Used for protected pages like `/workspaces`, `/settings`, and all workspace-scoped routes.
- **`GuestGuard`** -- requires no active session. If a session exists, redirects to `/`. Used for auth pages like `/login`, `/register`, `/forgot-password`, and `/reset-password`.
- **`TosGuard`** -- requires the authenticated user to have accepted the current Terms of Service version (checked via `GET /api/legal/tos-status`). If not accepted, redirects to `/accept-terms`. Nested inside `AuthGuard`, wrapping workspace-scoped routes, `/workspaces`, `/settings`, and `/notifications`.
- **`WorkspaceGuard`** -- requires the `:workspaceSlug` URL parameter to match a workspace the user belongs to. Fetches the user's workspaces from `/api/workspaces` and, if the slug is valid, prefetches the workspace detail into the React Query cache so that downstream `useWorkspace()` hooks read from a warm cache on first render. If the slug does not match any workspace, redirects to `/workspaces`.

All four guards show a loading spinner while their data is being fetched (`isPending` / `loading` state).

### Current Routes

#### Guest Routes (GuestGuard)

| Path | Page | Notes |
|---|---|---|
| `/login` | Login | |
| `/register` | Register | |
| `/forgot-password` | ForgotPassword | |
| `/reset-password` | ResetPassword | |

#### Authenticated Routes (AuthGuard)

| Path | Layout | Page | Notes |
|---|---|---|---|
| `/` | -- | HomeRedirect | Redirects to `/w/:lastSlug/dashboard` if a workspace slug is stored in `localStorage`, otherwise to `/workspaces` |
| `/workspaces` | -- | Workspaces | Workspace picker / create workspace (TosGuard) |
| `/settings` | -- | Settings | User-level settings (TosGuard) |
| `/notifications` | -- | Notifications | Standalone notifications (TosGuard) |
| `/accept-terms` | -- | AcceptTerms | ToS acceptance prompt for existing users (no TosGuard) |

#### Public Routes (no guard)

| Path | Page | Notes |
|---|---|---|
| `/terms` | Terms | Public Terms of Service page |
| `/privacy` | Privacy | Public Privacy Policy page |

#### Workspace Routes (AuthGuard + TosGuard + WorkspaceGuard + WorkspaceLayout)

All routes below are nested under `/w/:workspaceSlug` and rendered inside `WorkspaceLayout` (sidebar + navbar).

| Path | Page | Notes |
|---|---|---|
| `/w/:workspaceSlug` | -- | Redirects to `dashboard` |
| `/w/:workspaceSlug/dashboard` | Dashboard | |
| `/w/:workspaceSlug/my-tasks` | MyTasks | |
| `/w/:workspaceSlug/projects` | ProjectList | |
| `/w/:workspaceSlug/settings` | WorkspaceSettings | |
| `/w/:workspaceSlug/settings/members` | WorkspaceMembers | |
| `/w/:workspaceSlug/notifications` | Notifications | Workspace-scoped notifications view with breadcrumbs |

#### Project Routes (AuthGuard + TosGuard + WorkspaceGuard + WorkspaceLayout + ProjectLayout)

Project routes are nested under `/w/:workspaceSlug/projects/:projectId` and additionally wrapped in `ProjectLayout`, which provides breadcrumbs, tab navigation, `ProjectProvider`, and — for project admins — inline editing of the project name (click-to-edit) and icon (popover picker).

| Path | Page | Notes |
|---|---|---|
| `/w/:workspaceSlug/projects/:projectId` | -- | Redirects to `board` |
| `/w/:workspaceSlug/projects/:projectId/board` | ProjectBoard | |
| `/w/:workspaceSlug/projects/:projectId/list` | ProjectListView | |
| `/w/:workspaceSlug/projects/:projectId/timeline` | ProjectTimeline | |
| `/w/:workspaceSlug/projects/:projectId/dashboard` | ProjectDashboard | Stats, overdue tasks, priority breakdown, activity feed |
| `/w/:workspaceSlug/projects/:projectId/settings` | ProjectSettings | |

#### Invitation Routes

| Path | Guard | Page | Notes |
|---|---|---|---|
| `/invite/:token` | None | InviteAccept | Works for both authenticated and unauthenticated users |

#### Unguarded Routes

| Path | Page | Notes |
|---|---|---|
| `/terms` | Terms | Public Terms of Service |
| `/privacy` | Privacy | Public Privacy Policy |
| `/theme-editor` | ThemeEditor | |
| `*` | NotFound | Catch-all 404 page |

### Unauthorized Redirect

The `App.tsx` includes an `UnauthorizedRedirect` component that listens for 401 responses from the API client. When a 401 is received (e.g., expired session), the user sees a toast message and is redirected to `/login`. This redirect is suppressed on guest paths (`/login`, `/register`, `/forgot-password`, `/reset-password`) to avoid redirect loops.

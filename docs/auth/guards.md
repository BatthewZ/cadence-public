# Route Guards

Route guards are React components that wrap page components to control access based on auth state. They are defined in `src/web/components/guards/` and re-exported from `src/web/components/guards/index.ts`.

### AuthGuard

**File**: `src/web/components/guards/AuthGuard.tsx`

Requires an active session. If the session is loading, shows a spinner. If no session exists, redirects to `/login`.

```tsx
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <Center className="min-h-screen">
        <Spinner size="lg" />
      </Center>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
```

**Usage**:

```tsx
<Route
  path="/dashboard"
  element={
    <AuthGuard>
      <Dashboard />
    </AuthGuard>
  }
/>
```

### GuestGuard

**File**: `src/web/components/guards/GuestGuard.tsx`

Requires no active session. Shows a spinner only while the session is *initially* unknown. If a session exists, redirects to `/`.

```tsx
export function GuestGuard({ children }: { children: React.ReactNode }) {
  // Not `useSession` — see `useGuestSession` below.
  const { session, showInitialLoader } = useGuestSession();

  if (showInitialLoader) {
    return (
      <Center className="min-h-screen">
        <Spinner size="lg" />
      </Center>
    );
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
```

**Usage**:

```tsx
<Route
  path="/login"
  element={
    <GuestGuard>
      <Login />
    </GuestGuard>
  }
/>
```

#### `useGuestSession`

**File**: `src/web/lib/auth/use-guest-session.ts`

Session state for surfaces rendered to logged-out visitors — the guest routes and the landing page. It returns `{ session, showInitialLoader }`, where `showInitialLoader` is true only while the session is genuinely unknown, i.e. before the first resolve of this mount.

The distinction matters because Better Auth re-arms `useSession().isPending` on every background refetch whenever the current session data is `null`, and refetches fire on window focus, tab visibility, storage events, coming back online, and any session-mutating call. A component that renders a spinner whenever `isPending` is true therefore swaps its whole subtree out mid-session and React discards the state inside it. Registering calls `signUp.email`, which triggers a refetch — enough to remount `Register` and wipe the "check your email" confirmation it had just shown. `ForgotPassword` and `ResetPassword` end on post-submit views with the same hazard, and the landing page loses scroll position and any open mobile nav on a plain tab-switch.

After the first resolve, a refetch changes nothing about whether a guest surface is safe to render: the only outcome that matters is a session *appearing*, and callers act on `session` on the very next render.

`AuthGuard` deliberately does **not** use it. There the fail-closed behaviour is correct — an unknown session on a protected page must render nothing rather than show protected UI and redirect a beat later.

Also used by `HomeRedirect` (`src/web/components/HomeRedirect.tsx`), which renders the public landing page inline for logged-out visitors and, for a signed-in one, forwards to the last-visited workspace dashboard or `/workspaces`.

### TosGuard

**File**: `src/web/components/guards/TosGuard.tsx`

Requires the authenticated user to have accepted the current Terms of Service version. Queries `GET /api/legal/tos-status` to check acceptance status. If the user has not accepted, redirects to `/accept-terms`. Shows a spinner while loading and a `QueryErrorRetry` prompt on error.

This guard is the **only** place ToS acceptance is demanded. Registration does not collect it — sign-up produces no session under `requireEmailVerification`, so there would be nothing to record the acceptance against — which means every user meets this guard on their first hop into a guarded route after their first sign-in. See [Terms of Service Acceptance](./flows.md#terms-of-service-acceptance).

```tsx
export function TosGuard({ children }: { children: React.ReactNode }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: queryKeys.legal.tosStatus,
    queryFn: () => api.get<TosStatusResponse>("/api/legal/tos-status"),
    staleTime: 5 * 60 * 1000,
  });

  if (isPending) { /* spinner */ }
  if (isError) { /* <QueryErrorRetry onRetry={refetch} /> */ }
  if (!data?.accepted) {
    return <Navigate to="/accept-terms" replace />;
  }

  return <>{children}</>;
}
```

**Usage**: Nested inside `AuthGuard`, wrapping workspace-scoped routes, `/workspaces`, `/settings`, and `/notifications`:

```tsx
<Route
  path="/w/:workspaceSlug"
  element={
    <AuthGuard>
      <TosGuard>
        <WorkspaceGuard>
          <WorkspaceLayout />
        </WorkspaceGuard>
      </TosGuard>
    </AuthGuard>
  }
/>
```

Two routes are deliberately outside it (`src/web/App.tsx`):

- **`/accept-terms`** is mounted under `AuthGuard` only. Wrapping the acceptance page in the guard that redirects to it would be a redirect loop.
- **`/invite/:token`** is mounted under **neither** guard. The invite link has to work for someone who has no account yet and is a member of nothing, so an invitee accepts before any Terms prompt; the prompt appears on their next hop into a guarded route. Do not read that path as Terms-gated.

### WorkspaceGuard

**File**: `src/web/components/guards/WorkspaceGuard.tsx`

Gates workspace routes on a valid workspace slug. Resolves the URL slug to a workspace ID, then prefetches the workspace detail query so that downstream `useWorkspace()` hooks read from a warm React Query cache on first render — no context provider needed. Data lives in the React Query cache (external to the React component tree), so it survives Vite HMR without context-identity issues.

- **Loading** — shows a full-screen spinner while the workspace list and detail are being fetched.
- **Error** — displays the error message in a centered muted text block.
- **No match** — redirects to `/workspaces`.
- **Match** — renders children directly (workspace data is accessed via `useWorkspace()` hook reading from the query cache).

```tsx
export function WorkspaceGuard({ children }: { children: ReactNode }) {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();

  const { data, error, isLoading: loading } = useQuery({
    queryKey: queryKeys.workspaces.all,
    queryFn: () => api.get<WorkspacesResponse>("/api/workspaces"),
  });

  const workspaces = data?.workspaces ?? [];
  const workspace = workspaceSlug ? findWorkspaceBySlug(workspaces, workspaceSlug) : undefined;

  // Prefetch workspace detail so useWorkspace() reads from warm cache
  const { isLoading: detailLoading, error: detailError } = useQuery({
    queryKey: queryKeys.workspaces.detail(workspace?.id ?? ""),
    queryFn: () => api.get<{ workspace: Workspace }>(`/api/workspaces/${workspace!.id}`),
    staleTime: 5 * 60_000,
    enabled: !!workspace?.id,
  });

  if (loading || detailLoading) {
    return (
      <Center className="min-h-screen">
        <Spinner size="lg" />
      </Center>
    );
  }

  if (error || detailError) {
    return (
      <Center className="min-h-screen">
        <Text variant="body-1" color="muted">
          {error?.message ?? detailError?.message}
        </Text>
      </Center>
    );
  }

  if (!workspace) {
    return <Navigate to="/workspaces" replace />;
  }

  return <>{children}</>;
}
```

> `findWorkspaceBySlug` (from `WorkspaceContext.tsx`) handles the case where multiple workspaces share the same slug (possible now that slugs are unique per owner, not globally). It prefers the workspace the user owns, falling back to the first match.

**Usage**:

```tsx
<Route
  path="/:workspaceSlug"
  element={
    <AuthGuard>
      <WorkspaceGuard>
        <WorkspaceLayout />
      </WorkspaceGuard>
    </AuthGuard>
  }
/>
```

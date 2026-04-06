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

Requires no active session. If the session is loading, shows a spinner. If a session exists, redirects to `/`.

```tsx
export function GuestGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();

  if (isPending) {
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

### TosGuard

**File**: `src/web/components/guards/TosGuard.tsx`

Requires the authenticated user to have accepted the current Terms of Service version. Queries `GET /api/legal/tos-status` to check acceptance status. If the user has not accepted, redirects to `/accept-terms`. Shows a spinner while loading and a retry prompt on error.

```tsx
export function TosGuard({ children }: { children: React.ReactNode }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: queryKeys.legal.tosStatus,
    queryFn: () => api.get<TosStatusResponse>("/api/legal/tos-status"),
    staleTime: 5 * 60 * 1000,
  });

  if (isPending) { /* spinner */ }
  if (isError) { /* retry prompt */ }
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

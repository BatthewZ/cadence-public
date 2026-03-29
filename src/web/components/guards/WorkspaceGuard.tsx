import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";

import { Center } from "@/web/components/layout";
import { Spinner, Text } from "@/web/components/ui";
import { findWorkspaceBySlug, type Workspace, type WorkspacesResponse } from "@/web/contexts/WorkspaceContext";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

/**
 * Gates workspace routes on a valid workspace slug.
 *
 * Resolves the URL slug to a workspace ID, then prefetches the workspace
 * detail query so that downstream `useWorkspace()` hooks read from a warm
 * React Query cache on first render — no context provider needed.
 */
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

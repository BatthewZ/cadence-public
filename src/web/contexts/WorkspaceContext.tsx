import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useParams } from "react-router-dom";

import type { WorkspaceRole } from "@/shared/types/roles";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

/* ─── Types ─── */

export interface WorkspaceTeam {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  ownerId: string;
  theme?: string | null;
  role?: WorkspaceRole;
  memberCount?: number;
  members?: WorkspaceMember[];
  teams?: WorkspaceTeam[];
}

export interface WorkspacesResponse {
  workspaces: Workspace[];
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  role: string;
  joinedAt?: string;
  user: {
    id: string;
    name: string;
    email: string;
    image?: string;
  };
}

export interface WorkspaceProject {
  id: string;
  name: string;
  status: string;
  description?: string;
  theme?: string | null;
  icon?: string | null;
  memberCount?: number;
  taskCount?: number;
  taskCounts?: { total: number; completed: number };
  position?: string | null;
}

export interface WorkspaceContextValue {
  workspace: Workspace;
  members: WorkspaceMember[];
  projects: WorkspaceProject[];
  refetchProjects: () => Promise<void>;
  refetch: () => void;
  loading: boolean;
  error: string | null;
}

/* ─── Helpers ─── */

/**
 * Finds the best workspace match for a given slug from a list.
 *
 * Slugs are unique per owner, but a user could be a member of two workspaces
 * with the same slug (one they own, one they were invited to). In that case
 * this prefers the workspace the user owns, falling back to the first match.
 */
export function findWorkspaceBySlug(
  workspaces: Workspace[],
  slug: string,
): Workspace | undefined {
  const matches = workspaces.filter((w) => w.slug === slug);
  if (matches.length <= 1) return matches[0];
  return matches.find((w) => w.role === "owner") ?? matches[0];
}

/* ─── Internal Hooks ─── */

/**
 * Resolves the current workspace ID from the URL slug.
 * Returns null when rendered outside a workspace route.
 * Reads from the same cached workspaces-list query that WorkspaceGuard
 * populates, so no additional network request is made.
 */
function useWorkspaceId(): string | null {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { data } = useQuery({
    queryKey: queryKeys.workspaces.all,
    queryFn: () => api.get<WorkspacesResponse>("/api/workspaces"),
    staleTime: 5 * 60_000,
    enabled: !!workspaceSlug,
  });
  if (!workspaceSlug || !data) return null;
  return findWorkspaceBySlug(data.workspaces, workspaceSlug)?.id ?? null;
}

/**
 * Fires workspace detail, members, and projects queries via React Query.
 * When workspaceId is null the queries are disabled and return defaults.
 * Multiple components calling this hook share the same cache entries —
 * React Query deduplicates the underlying requests.
 */
function useWorkspaceQueries(workspaceId: string | null) {
  const qc = useQueryClient();
  const enabled = !!workspaceId;
  const id = workspaceId ?? "";

  const { data: workspaceData } = useQuery({
    queryKey: queryKeys.workspaces.detail(id),
    queryFn: () => api.get<{ workspace: Workspace }>(`/api/workspaces/${id}`),
    staleTime: 5 * 60_000,
    enabled,
  });

  const {
    data: membersData,
    error: membersError,
    isLoading: membersLoading,
  } = useQuery({
    queryKey: queryKeys.workspaces.members(id),
    queryFn: () => api.get<{ members: WorkspaceMember[] }>(`/api/workspaces/${id}/members`),
    staleTime: 5 * 60_000,
    enabled,
  });

  const {
    data: projectsData,
    error: projectsError,
    isLoading: projectsLoading,
  } = useQuery({
    queryKey: queryKeys.workspaces.projects(id),
    queryFn: () => api.get<{ projects: WorkspaceProject[] }>(`/api/workspaces/${id}/projects`),
    staleTime: 5 * 60_000,
    enabled,
  });

  const refetch = useCallback(() => {
    if (workspaceId) {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspaceId) });
    }
  }, [qc, workspaceId]);

  const refetchProjects = useCallback(async () => {
    if (workspaceId) {
      await qc.invalidateQueries({ queryKey: queryKeys.workspaces.projects(workspaceId) });
    }
  }, [qc, workspaceId]);

  return {
    workspace: workspaceData?.workspace ?? null,
    members: membersData?.members ?? [],
    projects: projectsData?.projects ?? [],
    refetchProjects,
    refetch,
    loading: membersLoading || projectsLoading,
    error: membersError?.message ?? projectsError?.message ?? null,
  };
}

/* ─── Hooks ─── */

/**
 * Access workspace data from the React Query cache.
 * Must be called under a workspace route (`/w/:workspaceSlug/…`)
 * and after WorkspaceGuard has loaded the workspace detail.
 *
 * Data lives in the React Query cache which is external to the React
 * component tree, so it survives Vite HMR without the context-identity
 * issues that plagued the former WorkspaceProvider approach.
 */
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useOptionalWorkspace();
  if (!ctx) {
    throw new Error("useWorkspace must be used within a workspace route with WorkspaceGuard mounted above");
  }
  return ctx;
}

/**
 * Returns the workspace data if available, or null if rendered outside
 * a workspace route. Useful for components that can be rendered both inside
 * and outside workspace layout (e.g., Notifications page).
 */
export function useOptionalWorkspace(): WorkspaceContextValue | null {
  const workspaceId = useWorkspaceId();
  const result = useWorkspaceQueries(workspaceId);

  if (!workspaceId || !result.workspace) return null;

  return {
    workspace: result.workspace,
    members: result.members,
    projects: result.projects,
    refetchProjects: result.refetchProjects,
    refetch: result.refetch,
    loading: result.loading,
    error: result.error,
  };
}

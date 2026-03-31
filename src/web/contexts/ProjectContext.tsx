import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";

import type { TaskLabelInfo } from "@/shared/schemas/label";
import type { ProjectStatus, TaskPriority } from "@/shared/types/roles";
import { Center } from "@/web/components/layout";
import { Spinner, Text } from "@/web/components/ui";
import { useProjectFreshness } from "@/web/hooks/use-project-freshness";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

/* ─── Types ─── */

export interface ProjectMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  image?: string | null;
  role: import("@/shared/types/roles").ProjectRole;
  joinedAt: string;
}

export interface Comment {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  position: string;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  workspaceId: string;
  theme?: string | null;
  icon?: string | null;
  coverImageKey?: string | null;
  coverImagePosition?: number | null;
  budget?: number | null;
  autoAssignCreator?: boolean;
  members?: ProjectMember[];
  taskGroups?: TaskGroup[];
}

export interface TaskGroup {
  id: string;
  name: string;
  color?: string;
  isCompletionGroup: boolean;
  position: string;
  taskCount?: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  taskGroupId: string;
  assigneeId?: string | null;
  assigneeName?: string;
  assigneeAvatarUrl?: string;
  priority: TaskPriority;
  completed: boolean;
  completedAt?: string | null;
  completedBy?: string | null;
  dueDate?: string | null;
  cost?: number | null;
  position: string;
  icon?: string | null;
  coverImageKey?: string | null;
  coverImagePosition?: number | null;
  subtaskCount?: number;
  subtaskCompletedCount?: number;
  commentCount?: number;
  attachmentCount?: number;
  labels?: TaskLabelInfo[];
}

export interface ProjectContextValue {
  project: Project;
  members: ProjectMember[];
  taskGroups: TaskGroup[];
  tasks: Task[];
  refetchTasks: () => void;
  refetchTaskGroups: () => void;
  refetch: () => void;
  // Optimistic update helpers — write directly to the React Query cache
  updateProject: (updates: Partial<Project>) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  removeTask: (taskId: string) => void;
  addTask: (task: Task) => void;
  updateTaskGroup: (groupId: string, updates: Partial<TaskGroup>) => void;
  removeTaskGroup: (groupId: string) => void;
  addTaskGroup: (group: TaskGroup) => void;
}

/* ─── Context ─── */

// Persist the context reference across Vite HMR updates so the
// provider/consumer identity stays stable and useProject() doesn't throw.
const hmrHot = (import.meta as unknown as Record<string, unknown>).hot as
  | { data: Record<string, unknown> }
  | undefined;

const ProjectContext: React.Context<ProjectContextValue | null> =
  (hmrHot?.data?.ProjectContext as React.Context<ProjectContextValue | null>) ??
  createContext<ProjectContextValue | null>(null);

if (hmrHot?.data) {
  hmrHot.data.ProjectContext = ProjectContext;
}

/* ─── Provider ─── */

interface ProjectProviderProps {
  projectId: string;
  children: ReactNode;
}

export function ProjectProvider({ projectId, children }: ProjectProviderProps) {
  const qc = useQueryClient();

  // Read workspace member count from the query cache (already populated by
  // WorkspaceLayout) to decide whether freshness polling is needed. Reading
  // from cache avoids creating extra hook instances that would spawn
  // duplicate polling timers.
  const workspaces = qc.getQueryData<{ workspaces: Array<{ id: string; memberCount?: number }> }>(queryKeys.workspaces.all);
  const projectDetail = qc.getQueryData<{ project: { workspaceId: string } }>(queryKeys.projects.detail(projectId));
  const wsId = projectDetail?.project.workspaceId ?? "";
  const wsMembers = qc.getQueryData<{ members: unknown[] }>(queryKeys.workspaces.members(wsId));
  const memberCount =
    wsMembers?.members.length
    ?? workspaces?.workspaces.find(w => w.id === wsId)?.memberCount
    ?? 0;
  const isMultiUser = memberCount > 1;

  // Only poll when the workspace has multiple members — if you're the sole
  // member nobody else can modify data, so polling would be wasted requests.
  useProjectFreshness(projectId, isMultiUser);

  const {
    data: projectData,
    error: projectError,
    isLoading: projectLoading,
  } = useQuery({
    queryKey: queryKeys.projects.detail(projectId),
    queryFn: () => api.get<{ project: Project }>(`/api/projects/${projectId}`),
    staleTime: 5 * 60_000,
  });

  const { data: membersData } = useQuery({
    queryKey: queryKeys.projects.members(projectId),
    queryFn: () => api.get<{ members: Array<{ id: string; userId: string; role: string; user: { id: string; name: string; email: string; image?: string }; addedAt: string }> }>(`/api/projects/${projectId}/members`),
    staleTime: 5 * 60_000,
  });

  const { data: taskGroupsData } = useQuery({
    queryKey: queryKeys.projects.taskGroups(projectId),
    queryFn: () => api.get<{ taskGroups: TaskGroup[] }>(`/api/projects/${projectId}/task-groups`),
  });

  const { data: tasksData } = useQuery({
    queryKey: queryKeys.projects.tasks(projectId),
    queryFn: () => api.get<{ tasks: Task[] }>(`/api/projects/${projectId}/tasks`),
  });

  // Optimistic helpers — write directly to the React Query cache.
  // No more local state overlays or useEffect sync.
  const updateProject = useCallback((updates: Partial<Project>) => {
    qc.setQueryData(
      queryKeys.projects.detail(projectId),
      (old: { project: Project } | undefined) =>
        old ? { project: { ...old.project, ...updates } } : old,
    );
  }, [qc, projectId]);

  const updateTask = useCallback((taskId: string, updates: Partial<Task>) => {
    qc.setQueryData(
      queryKeys.projects.tasks(projectId),
      (old: { tasks: Task[] } | undefined) => {
        if (!old) return old;
        return { tasks: old.tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)) };
      },
    );
  }, [qc, projectId]);

  const removeTask = useCallback((taskId: string) => {
    qc.setQueryData(
      queryKeys.projects.tasks(projectId),
      (old: { tasks: Task[] } | undefined) => {
        if (!old) return old;
        return { tasks: old.tasks.filter((t) => t.id !== taskId) };
      },
    );
  }, [qc, projectId]);

  const addTask = useCallback((task: Task) => {
    qc.setQueryData(
      queryKeys.projects.tasks(projectId),
      (old: { tasks: Task[] } | undefined) => {
        if (!old) return { tasks: [task] };
        return { tasks: [...old.tasks, task] };
      },
    );
  }, [qc, projectId]);

  const updateTaskGroup = useCallback((groupId: string, updates: Partial<TaskGroup>) => {
    qc.setQueryData(
      queryKeys.projects.taskGroups(projectId),
      (old: { taskGroups: TaskGroup[] } | undefined) => {
        if (!old) return old;
        return { taskGroups: old.taskGroups.map((g) => (g.id === groupId ? { ...g, ...updates } : g)) };
      },
    );
  }, [qc, projectId]);

  const removeTaskGroup = useCallback((groupId: string) => {
    qc.setQueryData(
      queryKeys.projects.taskGroups(projectId),
      (old: { taskGroups: TaskGroup[] } | undefined) => {
        if (!old) return old;
        return { taskGroups: old.taskGroups.filter((g) => g.id !== groupId) };
      },
    );
  }, [qc, projectId]);

  const addTaskGroup = useCallback((group: TaskGroup) => {
    qc.setQueryData(
      queryKeys.projects.taskGroups(projectId),
      (old: { taskGroups: TaskGroup[] } | undefined) => {
        if (!old) return { taskGroups: [group] };
        return { taskGroups: [...old.taskGroups, group] };
      },
    );
  }, [qc, projectId]);

  const refetchTasks = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });
  }, [qc, projectId]);

  const refetchTaskGroups = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.projects.taskGroups(projectId) });
  }, [qc, projectId]);

  const refetch = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  }, [qc, projectId]);

  const project = projectData?.project;

  const rawMembers = membersData?.members;
  const mappedMembers = useMemo(
    () =>
      (rawMembers ?? []).map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        image: m.user.image,
        role: m.role as import("@/shared/types/roles").ProjectRole,
        joinedAt: m.addedAt,
      })),
    [rawMembers],
  );

  // Only gate on the essential project query — task groups and tasks load
  // in the background and degrade gracefully to empty arrays if they fail
  if (projectLoading) {
    return (
      <Center className="min-h-screen">
        <Spinner size="lg" />
      </Center>
    );
  }

  if (projectError || !project) {
    return (
      <Center className="min-h-screen">
        <Text variant="body-1" color="muted">
          {projectError?.message ?? "Failed to load project"}
        </Text>
      </Center>
    );
  }

  return (
    <ProjectContext.Provider
      value={{
        project,
        members: mappedMembers,
        taskGroups: taskGroupsData?.taskGroups ?? [],
        tasks: tasksData?.tasks ?? [],
        refetchTasks,
        refetchTaskGroups,
        refetch,
        updateProject,
        updateTask,
        removeTask,
        addTask,
        updateTaskGroup,
        removeTaskGroup,
        addTaskGroup,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

/* ─── Hook ─── */

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return ctx;
}

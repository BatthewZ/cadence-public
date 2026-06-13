export const queryKeys = {
  workspaces: {
    all: ["workspaces"] as const,
    detail: (id: string) => ["workspaces", id] as const,
    members: (id: string) => ["workspaces", id, "members"] as const,
    projects: (id: string) => ["workspaces", id, "projects"] as const,
    invitations: (id: string) => ["workspaces", id, "invitations"] as const,
    teams: (id: string) => ["workspaces", id, "teams"] as const,
    teamDetail: (workspaceId: string, teamId: string) =>
      ["workspaces", workspaceId, "teams", teamId] as const,
    dashboard: (id: string) => ["workspaces", id, "dashboard"] as const,
    dashboardMyTasksPrefix: (id: string) =>
      ["workspaces", id, "dashboard", "my-tasks"] as const,
    /**
     * The trailing segment is a normalized OBJECT, not a joined string like
     * the project/task-group segments. Those segments hold nanoid lists, so
     * `","` can never appear inside a value — but `labelNames` are
     * user-entered text, and joining them with any separator could collide two
     * distinct filter states into one cache key. TanStack Query hashes object
     * segments with a stable, key-sorted serialization, so the object form is
     * unambiguous. Arrays are sorted so the key is stable under reordering
     * (selecting "urgent" then "high" hits the same cache entry as the
     * reverse), and every field is always present (with an empty default) so
     * all variants have the same segment count — prefix invalidation via
     * `dashboardMyTasksPrefix` keeps covering every combination.
     */
    dashboardMyTasks: (
      id: string,
      period?: string,
      projectIds?: string[],
      taskGroupIds?: string[],
      filters?: {
        priorities?: readonly string[];
        dueDateFrom?: string | null;
        dueDateTo?: string | null;
        noDueDate?: boolean;
        labelNames?: readonly string[];
        noLabel?: boolean;
      },
    ) =>
      [
        "workspaces",
        id,
        "dashboard",
        "my-tasks",
        period ?? "all",
        projectIds && projectIds.length > 0 ? [...projectIds].sort().join(",") : "",
        taskGroupIds && taskGroupIds.length > 0 ? [...taskGroupIds].sort().join(",") : "",
        {
          priority: filters?.priorities ? [...filters.priorities].sort() : [],
          dueDateFrom: filters?.dueDateFrom ?? "",
          dueDateTo: filters?.dueDateTo ?? "",
          noDueDate: filters?.noDueDate ?? false,
          label: filters?.labelNames ? [...filters.labelNames].sort() : [],
          noLabel: filters?.noLabel ?? false,
        },
      ] as const,
    taskGroups: (id: string, projectIds: string[]) =>
      ["workspaces", id, "task-groups", projectIds.join(",")] as const,
    /** Workspace-wide deduplicated label options (see `useWorkspaceLabels`). */
    labels: (id: string) => ["workspaces", id, "labels"] as const,
    dashboardMyTasksPreview: (id: string) =>
      ["workspaces", id, "dashboard", "my-tasks-preview"] as const,
    dashboardUpcoming: (id: string) =>
      ["workspaces", id, "dashboard", "upcoming"] as const,
    activity: (id: string) => ["workspaces", id, "activity"] as const,
    search: (id: string, query: string) =>
      ["workspaces", id, "search", query] as const,
    webhooks: (id: string) => ["workspaces", id, "webhooks"] as const,
    webhookDetail: (wsId: string, whId: string) =>
      ["workspaces", wsId, "webhooks", whId] as const,
    /**
     * Per-user calendar-feed status for a workspace. The cache only ever
     * holds `{ exists, createdAt, lastUsedAt }` metadata — never the feed
     * URL itself. The URL is a capability (anyone holding it can read the
     * user's assigned task titles and dates), so the POST response that
     * mints it is kept in component state and deliberately never written
     * into React Query, keeping the reveal-once posture auditable: there is
     * exactly one place the plaintext can live, and it dies on dismissal.
     */
    calendarFeed: (id: string) => ["workspaces", id, "calendar-feed"] as const,
  },
  projects: {
    detail: (id: string) => ["projects", id] as const,
    members: (id: string) => ["projects", id, "members"] as const,
    taskGroups: (id: string) => ["projects", id, "task-groups"] as const,
    tasks: (id: string) => ["projects", id, "tasks"] as const,
    labels: (id: string) => ["projects", id, "labels"] as const,
    /**
     * Per-user saved views for a project. Lives under the ["projects", id]
     * prefix (like labels/tasks) so broad project-level invalidation covers
     * it; no per-view detail key exists because the API only exposes a list —
     * the ViewSwitcher consumes whole lists and mutations edit the list cache.
     */
    savedViews: (id: string) => ["projects", id, "saved-views"] as const,
    dashboard: (id: string) => ["projects", id, "dashboard"] as const,
    activity: (id: string) => ["projects", id, "activity"] as const,
    webhooks: (id: string) => ["projects", id, "webhooks"] as const,
    webhookDetail: (projectId: string, webhookId: string) =>
      ["projects", projectId, "webhooks", webhookId] as const,
  },
  tasks: {
    detail: (id: string) => ["tasks", id] as const,
    activity: (id: string) => ["tasks", id, "activity"] as const,
    comments: (id: string) => ["tasks", id, "comments"] as const,
    attachments: (id: string) => ["tasks", id, "attachments"] as const,
  },
  invitations: {
    byToken: (token: string) => ["invitations", token] as const,
    pending: ["invitations", "pending"] as const,
  },
  legal: {
    tosStatus: ["legal", "tos-status"] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    list: (filters?: { unreadOnly?: boolean }) =>
      ["notifications", "list", filters] as const,
    unreadCount: ["notifications", "unread-count"] as const,
  },
  freshness: {
    project: (id: string) => ["freshness", "project", id] as const,
    workspace: (id: string) => ["freshness", "workspace", id] as const,
  },
} as const;

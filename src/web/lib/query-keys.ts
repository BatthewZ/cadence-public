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
    dashboardMyTasks: (id: string, period?: string) =>
      ["workspaces", id, "dashboard", "my-tasks", period ?? "all"] as const,
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
  },
  projects: {
    detail: (id: string) => ["projects", id] as const,
    members: (id: string) => ["projects", id, "members"] as const,
    taskGroups: (id: string) => ["projects", id, "task-groups"] as const,
    tasks: (id: string) => ["projects", id, "tasks"] as const,
    labels: (id: string) => ["projects", id, "labels"] as const,
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

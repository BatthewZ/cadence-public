import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Popover } from "@/web/components/ui/Popover";
import { useWorkspace, type WorkspacesResponse } from "@/web/contexts/WorkspaceContext";
import { useNotificationMutations } from "@/web/hooks/use-notification-mutations";
import { api } from "@/web/lib/api/client";
import { jitteredInterval } from "@/web/lib/poll-interval";
import { queryKeys } from "@/web/lib/query-keys";

import { type Notification, NotificationPanel } from "./NotificationPanel";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const { markReadMutation, markAllReadMutation } = useNotificationMutations();

  const { data: countData } = useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: () =>
      api.get<{ count: number }>("/api/notifications/unread-count"),
    refetchInterval: jitteredInterval(30_000),
    staleTime: 15_000,
  });

  // Fetch full list only when popover is open
  const { data: listData, isLoading } = useQuery({
    queryKey: queryKeys.notifications.list(),
    queryFn: () =>
      api.get<{ notifications: Notification[] }>(
        "/api/notifications?limit=30",
      ),
    enabled: open,
  });

  // Fetch all workspaces to build slug map for cross-workspace notification navigation
  const { data: wsData } = useQuery({
    queryKey: queryKeys.workspaces.all,
    queryFn: () => api.get<WorkspacesResponse>("/api/workspaces"),
    enabled: open,
  });

  const slugMap = useMemo(
    () => new Map((wsData?.workspaces ?? []).map((ws) => [ws.id, ws.slug])),
    [wsData],
  );

  const unreadCount = countData?.count ?? 0;
  const notifications = listData?.notifications ?? [];

  const handleNavigate = useCallback(
    (n: Notification) => {
      setOpen(false);

      // Resolve the workspace slug — use the notification's workspaceId to
      // look up the slug from all workspaces, falling back to the current
      // workspace slug when the notification belongs to this workspace or
      // the slug map hasn't loaded yet.
      const resolveSlug = (workspaceId: string | null | undefined): string => {
        if (workspaceId) {
          const slug = slugMap.get(workspaceId);
          if (slug) return slug;
        }
        return workspace.slug;
      };

      if (n.taskId && n.projectId) {
        const slug = resolveSlug(n.workspaceId);
        void navigate(
          `/w/${slug}/projects/${n.projectId}/board?task=${n.taskId}`,
        );
      } else if (n.invitationId) {
        void navigate("/workspaces");
      } else if (n.projectId) {
        // project_member_added — navigate to the project board
        const slug = resolveSlug(n.workspaceId);
        void navigate(`/w/${slug}/projects/${n.projectId}/board`);
      }
    },
    [navigate, slugMap, workspace.slug],
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={4}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="notification-bell"
          aria-label={
            unreadCount > 0
              ? `Notifications (${unreadCount} unread)`
              : "Notifications"
          }
        >
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="notification-badge">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content>
        <NotificationPanel
          notifications={notifications}
          isLoading={isLoading}
          onMarkAllRead={() => markAllReadMutation.mutate()}
          onMarkRead={(id) => markReadMutation.mutate(id)}
          onNavigate={handleNavigate}
          onClose={() => setOpen(false)}
          hasUnread={unreadCount > 0}
          viewAllHref={`/w/${workspace.slug}/notifications`}
        />
      </Popover.Content>
    </Popover>
  );
}

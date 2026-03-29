import {
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { ArrowLeft, Bell, FolderKanban } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Invitation } from "@/shared/types/invitations";
import { Container, Row, Stack } from "@/web/components/layout";
import { NotificationItem } from "@/web/components/layout/NotificationItem";
import { type Notification } from "@/web/components/layout/NotificationPanel";
import { Avatar, Button, Spinner, Text } from "@/web/components/ui";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import { QueryErrorRetry } from "@/web/components/ui/QueryErrorRetry";
import { useOptionalWorkspace, type WorkspacesResponse } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useInvitationActions } from "@/web/hooks/use-invitation-actions";
import { useNotificationMutations } from "@/web/hooks/use-notification-mutations";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { queryKeys } from "@/web/lib/query-keys";

import { type NotificationActionsContext, renderNotificationActions } from "./components/NotificationActions";
import { NotificationFilters } from "./components/NotificationFilters";

interface NotificationsPage {
  notifications: Notification[];
  nextCursor: string | null;
}

export default function Notifications() {
  useDocumentTitle("Notifications");

  const navigate = useNavigate();
  const { data: session } = useSession();
  const [unreadOnly, setUnreadOnly] = useState(false);

  // When rendered under WorkspaceLayout, workspace context is available.
  // When rendered at the standalone /notifications route, it is null.
  const workspaceCtx = useOptionalWorkspace();
  const isInsideWorkspace = workspaceCtx !== null;

  const { data: wsData } = useQuery({
    queryKey: queryKeys.workspaces.all,
    queryFn: () => api.get<WorkspacesResponse>("/api/workspaces"),
  });

  const slugMap = useMemo(
    () => new Map((wsData?.workspaces ?? []).map((ws) => [ws.id, ws.slug])),
    [wsData],
  );

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<NotificationsPage>({
    queryKey: queryKeys.notifications.list({ unreadOnly }),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "30" });
      if (unreadOnly) params.set("unreadOnly", "true");
      if (pageParam) params.set("cursor", pageParam as string);
      return api.get<NotificationsPage>(
        `/api/notifications?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  const { markReadMutation, markAllReadMutation } = useNotificationMutations({
    infiniteListFilter: { unreadOnly },
  });

  const { data: countData } = useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: () =>
      api.get<{ count: number }>("/api/notifications/unread-count"),
  });
  const unreadCount = countData?.count ?? 0;

  // Fetch pending invitations so we can offer Accept/Dismiss on invitation notifications
  const { data: pendingData } = useQuery({
    queryKey: queryKeys.invitations.pending,
    queryFn: () =>
      api.get<{ invitations: Invitation[] }>("/api/invitations/pending"),
    staleTime: 2 * 60_000,
  });

  const pendingTokenMap = useMemo(
    () =>
      new Map(
        (pendingData?.invitations ?? [])
          .filter((inv): inv is Invitation & { token: string } => !!inv.token)
          .map((inv) => [inv.id, inv.token]),
      ),
    [pendingData],
  );

  const { accept: acceptInvitation, dismiss: dismissInvitation, isAccepting } = useInvitationActions();

  const notifications = data?.pages.flatMap((p) => p.notifications) ?? [];

  const actionsCtx: NotificationActionsContext = {
    pendingTokenMap,
    isAccepting,
    acceptInvitation,
    dismissInvitation,
    slugMap,
    markReadMutation,
    navigate,
  };

  const handleNavigate = useCallback(
    (n: Notification) => {
      if (n.taskId && n.projectId && n.workspaceId) {
        const slug = slugMap.get(n.workspaceId);
        if (slug) {
          void navigate(
            `/w/${slug}/projects/${n.projectId}/board?task=${n.taskId}`,
          );
          return;
        }
      }
      if (n.invitationId) {
        void navigate("/workspaces");
      } else if (n.projectId && n.workspaceId) {
        const slug = slugMap.get(n.workspaceId);
        if (slug) {
          void navigate(`/w/${slug}/projects/${n.projectId}/board`);
        }
      }
    },
    [navigate, slugMap],
  );

  function handleClick(n: Notification) {
    if (!n.read) markReadMutation.mutate(n.id);
    handleNavigate(n);
  }

  const notificationContent = (
    <>
      <Container size={isInsideWorkspace ? "xl" : "md"} className="pt-r1 pb-r2">
        {isInsideWorkspace && workspaceCtx && (
          <Breadcrumbs className="pt-r2">
            <Breadcrumbs.Item href={`/w/${workspaceCtx.workspace.slug}/dashboard`}>{workspaceCtx.workspace.name}</Breadcrumbs.Item>
            <Breadcrumbs.Item current>Notifications</Breadcrumbs.Item>
          </Breadcrumbs>
        )}
        {/* Header */}
        <Row justify="between" align="center" className="pt-r2 pb-r3">
          <Row gap="r4" align="center">
            <Text variant="h3" className="tracking-tight">
              Notifications
            </Text>
          </Row>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => markAllReadMutation.mutate()}
            disabled={unreadCount === 0 || markAllReadMutation.isPending}
          >
            Mark all read
          </Button>
        </Row>

        {/* Filter tabs */}
        <NotificationFilters
          unreadOnly={unreadOnly}
          setUnreadOnly={setUnreadOnly}
          unreadCount={unreadCount}
        />

        {/* Notification list */}
        <div className="bg-surface-0 rounded-xl border border-border-default overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center py-r1">
              <Spinner size="lg" />
            </div>
          ) : isError ? (
            <QueryErrorRetry message="Failed to load notifications." onRetry={refetch} />
          ) : notifications.length === 0 ? (
            <Stack gap="r5" className="items-center py-r1">
              <Bell size={32} className="text-fg-muted" />
              <Text variant="body-2" color="muted">
                {unreadOnly
                  ? "No unread notifications"
                  : "No notifications yet"}
              </Text>
            </Stack>
          ) : (
            <>
              {notifications.map((n) => {
                const actions = renderNotificationActions(n, actionsCtx);
                return (
                  <NotificationItem
                    key={n.id}
                    title={n.title}
                    body={n.body}
                    read={n.read}
                    actorName={n.actorName}
                    actorImage={n.actorImage}
                    createdAt={n.createdAt}
                    onClick={() => handleClick(n)}
                    actions={actions}
                  />
                );
              })}
            </>
          )}
        </div>

        {/* Load more */}
        {hasNextPage && (
          <div className="flex justify-center mt-r4">
            <Button
              variant="ghost"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Loading..." : "Load more"}
            </Button>
          </div>
        )}
      </Container>
    </>
  );

  // When rendered inside WorkspaceLayout, skip the standalone top bar
  if (isInsideWorkspace) {
    return notificationContent;
  }

  // Standalone mode: render with its own top bar
  return (
    <div className="min-h-screen bg-surface-1">
      <div className="bg-surface-0 border-b border-border-default">
        <Container size="lg">
          <Row justify="between" align="center" className="h-14">
            <Row gap="r4" align="center">
              <button
                type="button"
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-2 transition-colors"
                onClick={() => void navigate(-1)}
                aria-label="Go back"
              >
                <ArrowLeft size={16} />
              </button>
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <FolderKanban size={16} className="text-fg-on-primary" />
              </div>
              <Text variant="h6" className="tracking-tight">
                Cadence
              </Text>
            </Row>
            {session?.user && (
              <Avatar
                size="sm"
                name={session.user.name ?? ""}
                src={session.user.image ?? undefined}
              />
            )}
          </Row>
        </Container>
      </div>
      {notificationContent}
    </div>
  );
}

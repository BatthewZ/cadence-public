import { ArrowRight, Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { type NavigateFunction } from "react-router-dom";

import { type Notification } from "@/web/components/layout/NotificationPanel";
import { type useNotificationMutations } from "@/web/hooks/use-notification-mutations";

export interface NotificationActionsContext {
  pendingTokenMap: Map<string, string>;
  isAccepting: boolean;
  acceptInvitation: (token: string) => void;
  dismissInvitation: (invitationId: string) => void;
  slugMap: Map<string, string>;
  markReadMutation: ReturnType<typeof useNotificationMutations>["markReadMutation"];
  navigate: NavigateFunction;
}

export function renderNotificationActions(
  n: Notification,
  ctx: NotificationActionsContext,
): ReactNode | undefined {
  const {
    pendingTokenMap,
    isAccepting,
    acceptInvitation,
    dismissInvitation,
    slugMap,
    markReadMutation,
    navigate,
  } = ctx;

  // Invitation notifications — show Accept/Dismiss if invitation is still pending
  if (n.type === "invitation_received" && n.invitationId) {
    const invitationId = n.invitationId;
    const token = pendingTokenMap.get(invitationId);
    if (token) {
      return (
        <>
          <button
            type="button"
            className="notification-action-btn"
            data-variant="primary"
            disabled={isAccepting}
            onClick={() => acceptInvitation(token)}
          >
            <Check size={12} />
            Accept
          </button>
          <button
            type="button"
            className="notification-action-btn"
            onClick={() => dismissInvitation(invitationId)}
          >
            <X size={12} />
            Dismiss
          </button>
        </>
      );
    }
  }

  // Task notifications — View task button
  if (
    (n.type === "task_assigned" ||
      n.type === "task_completed" ||
      n.type === "task_comment_mention") &&
    n.taskId &&
    n.projectId &&
    n.workspaceId
  ) {
    const slug = slugMap.get(n.workspaceId);
    if (slug) {
      return (
        <button
          type="button"
          className="notification-action-btn"
          onClick={() => {
            if (!n.read) markReadMutation.mutate(n.id);
            void navigate(
              `/w/${slug}/projects/${n.projectId}/board?task=${n.taskId}`,
            );
          }}
        >
          View task
          <ArrowRight size={12} />
        </button>
      );
    }
  }

  // Project member added — View project button
  if (
    n.type === "project_member_added" &&
    n.projectId &&
    n.workspaceId
  ) {
    const slug = slugMap.get(n.workspaceId);
    if (slug) {
      return (
        <button
          type="button"
          className="notification-action-btn"
          onClick={() => {
            if (!n.read) markReadMutation.mutate(n.id);
            void navigate(`/w/${slug}/projects/${n.projectId}/board`);
          }}
        >
          View project
          <ArrowRight size={12} />
        </button>
      );
    }
  }

  return undefined;
}

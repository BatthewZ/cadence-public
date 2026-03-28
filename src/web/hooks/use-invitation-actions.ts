import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/web/components/ui/ToastContext";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

/**
 * Provides unified accept/dismiss actions for workspace invitations.
 *
 * Both the Workspaces page and Notifications page handle invitations, but
 * previously they had inconsistent query invalidation and toast behavior.
 * This hook centralizes that logic so accepting/dismissing an invitation
 * always invalidates the same set of queries and shows the same feedback,
 * regardless of where the action is triggered.
 */
export function useInvitationActions() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const acceptMutation = useMutation({
    mutationFn: (token: string) =>
      api.post<{ ok: boolean; workspaceId: string }>(
        "/api/invitations/accept",
        { token },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      void qc.invalidateQueries({ queryKey: queryKeys.invitations.pending });
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications.unreadCount,
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications.list(),
      });
      toast("You have joined the workspace!", { variant: "success" });
    },
  });

  /**
   * Dismiss an invitation locally by removing it from the pending invitations
   * cache. This also invalidates the notifications list so the invitation
   * notification disappears. The invitation itself will expire server-side.
   */
  function dismiss(invitationId: string) {
    void qc.setQueryData(
      queryKeys.invitations.pending,
      (old: { invitations: { id: string }[] } | undefined) =>
        old
          ? {
              invitations: old.invitations.filter(
                (i) => i.id !== invitationId,
              ),
            }
          : old,
    );
    // Also invalidate notification list so the invitation notification reflects
    // the dismissed state consistently
    void qc.invalidateQueries({
      queryKey: queryKeys.notifications.list(),
    });
  }

  return {
    accept: acceptMutation.mutate,
    dismiss,
    isAccepting: acceptMutation.isPending,
  };
}

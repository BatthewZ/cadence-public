import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/web/components/ui/ToastContext";
import { api, apiErrorMessage } from "@/web/lib/api/client";
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

  /**
   * Accept by invitation **id**, not by token.
   *
   * The in-app surfaces (workspaces page, notifications panel) list
   * invitations that were sent to the signed-in user, and the server
   * authorises acceptance against that session's verified email. They
   * therefore never need — and no longer receive — the secret token:
   * `GET /api/invitations/pending` stopped returning it (audit finding 04).
   * The emailed `/invite/:token` link keeps its own token-based accept call
   * in `InviteAccept`, because a visitor arriving from email may not have a
   * session yet.
   */
  const acceptMutation = useMutation({
    mutationFn: (invitationId: string) =>
      api.post<{ ok: boolean; workspaceId: string }>(
        "/api/invitations/accept",
        { invitationId },
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
    /**
     * Without this the failure path was completely silent: the mutation defined
     * only `onSuccess`, the hook exposes no `error`, both call sites use
     * `mutate` (which never rejects), and there is no `MutationCache` error
     * handler in `lib/query-client.ts` to catch it. So an invitation that was
     * revoked, expired, or addressed to a different verified email answered
     * 409/400/403 and the user saw the button simply re-enable with the card
     * still sitting there — indistinguishable from a dead click.
     *
     * `apiErrorMessage` is used rather than a single generic string because
     * every one of those refusals names the actual reason ("This invitation has
     * expired", "You are already a member of this workspace"), and each points
     * at a different next action. The generic covers only the transport
     * failure, where the server said nothing at all.
     */
    onError: (err: unknown) => {
      toast(apiErrorMessage(err, "Failed to accept the invitation."), {
        variant: "error",
      });
    },
  });

  /**
   * Dismiss an invitation by dropping it from the pending-invitations cache.
   *
   * Purely client-side: there is no dismiss endpoint, and the invitation stays
   * `pending` on the server until the invitee accepts it, an admin revokes it,
   * or it expires after seven days.
   *
   * ## What the user actually sees, precisely
   *
   * The notification row does NOT disappear, and an earlier version of this
   * comment claimed it did. `queryKeys.invitations.pending` is the same key
   * `Notifications.tsx` builds `pendingInvitationIds` from, and
   * `renderNotificationActions` shows Accept/Dismiss only for ids in that set —
   * so removing the id retires the two buttons, leaving the notification itself
   * in the list exactly as a notification for an already-accepted or expired
   * invitation appears. The `notifications.list()` invalidation below refetches
   * from a server that still holds the same rows; it is what keeps any *other*
   * surface rendering the same list in step, not what removes anything.
   *
   * The removal is not permanent either: the pending query carries a two-minute
   * `staleTime`, so a later refetch restores the invitation and the buttons with
   * it. That is intended — dismissing is "not now", not a decision the server is
   * asked to remember.
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

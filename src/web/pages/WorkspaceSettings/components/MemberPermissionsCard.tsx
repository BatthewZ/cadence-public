import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";

import type { WorkspacePolicyPatch } from "@/shared/schemas/workspace";
import { Label } from "@/web/components/form";
import { Toggle } from "@/web/components/form/Toggle";
import { Row, Stack } from "@/web/components/layout";
import { Card } from "@/web/components/ui/Card";
import { Text } from "@/web/components/ui/Text";
import { useToast } from "@/web/components/ui/ToastContext";
import type { WorkspaceDetail } from "@/web/contexts/WorkspaceContext";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

interface MemberPermissionsCardProps {
  workspace: WorkspaceDetail;
}

/**
 * Admin-only card for the workspace's governance policy.
 *
 * ## Why this is a card of its own
 *
 * The General card is a form: you edit fields and press Save. These toggles
 * are not form fields — each one takes effect on release, because a governance
 * switch that sits in a dirty-but-unsaved state is a switch whose displayed
 * position lies about who can currently do what. Mixing "applies now" controls
 * into a "press Save" form is how that ambiguity gets built, so they are kept
 * physically apart.
 *
 * ## Why it renders only for admins
 *
 * The caller gates on `canManageWorkspace`, matching every other admin-only
 * section on this page. Showing a member a disabled switch would tell them
 * their admins had made a choice about them while offering nothing they can do
 * about it; the place a member learns about the policy is the tooltip on the
 * New Project button they cannot press, which is where the information is
 * actionable.
 */
export function MemberPermissionsCard({ workspace }: MemberPermissionsCardProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const detailKey = queryKeys.workspaces.detail(workspace.id);

  const { mutate: updatePolicy, isPending } = useMutation({
    mutationFn: (policy: WorkspacePolicyPatch) =>
      api.patch<{ workspace: WorkspaceDetail }>(`/api/workspaces/${workspace.id}`, { policy }),
    // Optimistic, because a switch that waits for a round-trip before moving
    // reads as broken and invites the double-click that sends a contradictory
    // second request. The rollback in `onError` is what makes that honest: on
    // failure the switch returns to the server's truth and says so, rather
    // than sitting in a position the backend never accepted.
    onMutate: async (policy) => {
      await qc.cancelQueries({ queryKey: detailKey });
      const previous = qc.getQueryData<{ workspace: WorkspaceDetail }>(detailKey);
      qc.setQueryData(
        detailKey,
        (old: { workspace: WorkspaceDetail } | undefined) =>
          old
            ? { workspace: { ...old.workspace, policy: { ...old.workspace.policy, ...policy } } }
            : old,
      );
      return { previous };
    },
    onError: (_err, _policy, context) => {
      if (context?.previous) qc.setQueryData(detailKey, context.previous);
      toast("Could not update member permissions.", { variant: "error" });
    },
    onSuccess: () => {
      toast("Member permissions updated.", { variant: "success" });
    },
    // Re-fetch on both paths. The optimistic value is a guess at the merge the
    // server performs in SQL; this replaces it with the merge that actually
    // happened, so a concurrent change by another admin surfaces here rather
    // than being papered over by our own optimistic write.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: detailKey });
    },
  });

  return (
    <Card>
      <Stack gap="r4">
        <Row gap="r5" align="center">
          <ShieldCheck size={18} className="text-accent" />
          <Text variant="h5">Member Permissions</Text>
        </Row>
        <Text variant="body-2" color="secondary">
          Choose what members can do on their own. Owners and admins are never affected by these
          settings.
        </Text>

        <Row justify="between" align="center" gap="r5" className="pt-r3">
          <Stack gap="r6">
            <Label htmlFor="policy-member-project-creation">Members can create projects</Label>
            <Text variant="body-3" color="muted">
              When off, only owners and admins can create new projects or duplicate existing ones.
            </Text>
          </Stack>
          <Toggle
            id="policy-member-project-creation"
            checked={workspace.policy.allowMemberProjectCreation}
            disabled={isPending}
            onCheckedChange={(next) => updatePolicy({ allowMemberProjectCreation: next })}
            aria-label="Members can create projects"
          />
        </Row>
      </Stack>
    </Card>
  );
}

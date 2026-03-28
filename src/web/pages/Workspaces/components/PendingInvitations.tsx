import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";

import type { Invitation } from "@/shared/types/invitations";
import { Row, Stack } from "@/web/components/layout";
import {
  Badge,
  Button,
  Text,
} from "@/web/components/ui";
import { useInvitationActions } from "@/web/hooks/use-invitation-actions";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

export function PendingInvitations() {
  const { data } = useQuery({
    queryKey: queryKeys.invitations.pending,
    queryFn: () =>
      api.get<{ invitations: Invitation[] }>("/api/invitations/pending"),
    staleTime: 2 * 60_000,
  });

  const { accept, dismiss, isAccepting } = useInvitationActions();

  const invitations = data?.invitations ?? [];
  if (invitations.length === 0) return null;

  return (
    <div className="mt-r3 mb-r3">
      <Row gap="r5" align="center" className="mb-r4">
        <Mail size={18} className="text-accent" />
        <Text variant="h5" className="tracking-tight">
          Pending Invitations
        </Text>
        <Badge variant="info">{invitations.length}</Badge>
      </Row>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-r4">
        {invitations.map((inv) => (
          <div
            key={inv.id}
            className="bg-surface-0 rounded-xl border border-accent/20 p-r4"
          >
            <Stack gap="r5">
              <Row gap="r4" align="start">
                <div className="w-11 h-11 rounded-lg bg-accent-subtle flex items-center justify-center flex-shrink-0">
                  <Mail size={20} className="text-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <Text variant="h5" className="truncate">
                    {inv.workspace?.name ?? "Unknown workspace"}
                  </Text>
                  {inv.invitedBy?.name && (
                    <Text variant="body-3" color="secondary" className="mt-0.5">
                      Invited by {inv.invitedBy.name}
                    </Text>
                  )}
                  <Row gap="r5" align="center" className="mt-r6">
                    <Badge variant="info">Role: {inv.role}</Badge>
                  </Row>
                </div>
              </Row>
              <Row gap="r5">
                <Button
                  size="sm"
                  variant="primary"
                  className="flex-1"
                  onClick={() => inv.token && accept(inv.token)}
                  disabled={isAccepting}
                >
                  {isAccepting ? "Accepting..." : "Accept"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => dismiss(inv.id)}
                >
                  Dismiss
                </Button>
              </Row>
            </Stack>
          </div>
        ))}
      </div>
    </div>
  );
}

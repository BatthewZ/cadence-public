import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import type { Invitation } from "@/shared/types/invitations";
import { parseWorkspaceRole, ROLE_LABELS, type WorkspaceRole } from "@/shared/types/roles";
import { Container, Divider, Row, Stack } from "@/web/components/layout";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  Text,
} from "@/web/components/ui";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import { useToast } from "@/web/components/ui/ToastContext";
import { useWorkspace, type WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useWorkspacePermissions } from "@/web/hooks/use-permissions";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { getRoleBadgeVariant } from "@/web/util/role-display";

import { ChangeRoleDialog } from "./components/ChangeRoleDialog";
import { InviteMemberDialog } from "./components/InviteMemberDialog";
import { getMemberColumns } from "./components/MemberColumns";
import { RemoveMemberDialog } from "./components/RemoveMemberDialog";
import { SettingsNav } from "./SettingsNav";

interface InvitationInput {
  email: string;
  role: WorkspaceRole;
}

export default function WorkspaceMembers() {
  const { workspace, members } = useWorkspace();
  useDocumentTitle(`${workspace.name} — Members`);
  const { toast } = useToast();
  const { canManageWorkspace } = useWorkspacePermissions();

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<WorkspaceMember | null>(null);
  const [newRole, setNewRole] = useState<WorkspaceRole>("member");
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);
  const [removeMemberName, setRemoveMemberName] = useState("");
  const [removing, setRemoving] = useState(false);

  const workspaceId = workspace?.id ?? "";
  const qc = useQueryClient();

  const {
    data: invitationsData,
    isLoading: invitationsLoading,
  } = useQuery({
    queryKey: queryKeys.workspaces.invitations(workspaceId),
    queryFn: () => api.get<{ invitations: Invitation[] }>(`/api/workspaces/${workspaceId}/invitations`),
    staleTime: 5 * 60_000,
  });
  const invitations = invitationsData?.invitations ?? [];

  const { mutateAsync: sendInvitation, isPending: inviting, error: inviteErrorObj } = useMutation({
    mutationFn: (input: InvitationInput) =>
      api.post<unknown>(`/api/workspaces/${workspaceId}/invitations`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.invitations(workspaceId) });
    },
  });
  const inviteError = inviteErrorObj?.message ?? null;

  const [updatingRole, setUpdatingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  // members comes from context, not workspace object

  const columns = getMemberColumns({
    canManageWorkspace,
    onChangeRole: (row) => {
      setSelectedMember(row);
      setNewRole(parseWorkspaceRole(row.role));
      setRoleDialogOpen(true);
    },
    onRemoveMember: (row) => {
      setRemoveMemberId(row.id);
      setRemoveMemberName(row.user.name);
    },
  });

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    try {
      await sendInvitation({ email: inviteEmail.trim(), role: inviteRole });
      toast("Invitation sent.", { variant: "success" });
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteRole("member");
    } catch {
      // error is captured by the mutation state
    }
  }

  async function handleRevokeInvitation(invitationId: string) {
    try {
      const { api } = await import("@/web/lib/api/client");
      await api.delete(`/api/workspaces/${workspaceId}/invitations/${invitationId}`);
      toast("Invitation revoked.", { variant: "success" });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.invitations(workspaceId) });
    } catch {
      toast("Failed to revoke invitation.", { variant: "error" });
    }
  }

  async function handleChangeRole() {
    if (!selectedMember) return;
    setUpdatingRole(true);
    setRoleError(null);
    try {
      const { api } = await import("@/web/lib/api/client");
      await api.patch(`/api/workspaces/${workspaceId}/members/${selectedMember.id}`, {
        role: newRole,
      });
      toast("Role updated.", { variant: "success" });
      setRoleDialogOpen(false);
      setSelectedMember(null);
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspaceId) });
    } catch (err) {
      const { ApiError } = await import("@/web/lib/api/client");
      setRoleError(err instanceof ApiError ? err.message : "Failed to update role.");
    } finally {
      setUpdatingRole(false);
    }
  }

  async function handleRemoveMember() {
    if (!removeMemberId) return;
    setRemoving(true);
    try {
      const { api } = await import("@/web/lib/api/client");
      await api.delete(`/api/workspaces/${workspaceId}/members/${removeMemberId}`);
      toast("Member removed.", { variant: "success" });
      setRemoveMemberId(null);
      setRemoveMemberName("");
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspaceId) });
    } catch {
      toast("Failed to remove member.", { variant: "error" });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Container size="lg">
      <Stack gap="r3" className="py-r2">
        <Breadcrumbs>
          <Breadcrumbs.Item href={`/w/${workspace.slug}/dashboard`}>{workspace.name}</Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/w/${workspace.slug}/settings`}>Settings</Breadcrumbs.Item>
          <Breadcrumbs.Item current>Members</Breadcrumbs.Item>
        </Breadcrumbs>
        <Text variant="h3">Workspace Settings</Text>
        <SettingsNav basePath={`/w/${workspace.slug}/settings`} />

        <Row justify="between" align="center">
          <Text variant="body-2" color="secondary">
            {members.length} {members.length === 1 ? "member" : "members"}
          </Text>
          {canManageWorkspace && (
            <Button variant="primary" size="md" onClick={() => setInviteDialogOpen(true)}>
              Invite Member
            </Button>
          )}
        </Row>

        <DataTable
          data={members}
          columns={columns}
          rowKey={(row) => row.id}
          loading={!workspace}
        />

        <Divider />

        <Text variant="h4">Pending Invitations</Text>

        {invitationsLoading ? (
          <Text variant="body-2" color="muted">Loading invitations...</Text>
        ) : !invitations || invitations.length === 0 ? (
          <EmptyState size="sm">
            <EmptyStateTitle>No pending invitations</EmptyStateTitle>
            <EmptyStateDescription>
              Invite members to your workspace to start collaborating.
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <Stack gap="r5">
            {invitations.map((invitation) => (
              <Row key={invitation.id} justify="between" align="center" className="py-r5">
                <Row gap="r4" align="center">
                  <Text variant="body-2">{invitation.email}</Text>
                  <Badge variant={getRoleBadgeVariant(invitation.role)}>
                    {ROLE_LABELS[invitation.role]}
                  </Badge>
                  <Text variant="body-3" color="muted">
                    Sent {invitation.createdAt ? new Date(invitation.createdAt).toLocaleDateString() : "—"}
                  </Text>
                </Row>
                {canManageWorkspace && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleRevokeInvitation(invitation.id)}
                  >
                    Revoke
                  </Button>
                )}
              </Row>
            ))}
          </Stack>
        )}
      </Stack>

      {canManageWorkspace && (
        <>
          <InviteMemberDialog
            open={inviteDialogOpen}
            onClose={() => setInviteDialogOpen(false)}
            inviteEmail={inviteEmail}
            onInviteEmailChange={setInviteEmail}
            inviteRole={inviteRole}
            onInviteRoleChange={setInviteRole}
            inviting={inviting}
            inviteError={inviteError}
            onSubmit={(e) => void handleInvite(e)}
          />

          <ChangeRoleDialog
            open={roleDialogOpen}
            onClose={() => {
              setRoleDialogOpen(false);
              setSelectedMember(null);
            }}
            selectedMember={selectedMember}
            newRole={newRole}
            onNewRoleChange={setNewRole}
            updatingRole={updatingRole}
            roleError={roleError}
            onSubmit={() => void handleChangeRole()}
          />

          <RemoveMemberDialog
            open={removeMemberId !== null}
            onClose={() => {
              if (!removing) {
                setRemoveMemberId(null);
                setRemoveMemberName("");
              }
            }}
            onConfirm={() => void handleRemoveMember()}
            removing={removing}
            memberName={removeMemberName}
            workspaceName={workspace.name}
          />
        </>
      )}
    </Container>
  );
}

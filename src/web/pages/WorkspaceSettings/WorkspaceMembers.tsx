import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import type { Invitation } from "@/shared/types/invitations";
import { parseWorkspaceRole, ROLE_LABELS, type WorkspaceRole } from "@/shared/types/roles";
import { Input } from "@/web/components/form";
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
import { api, apiErrorMessage } from "@/web/lib/api/client";
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
  const { canManageWorkspace, isWorkspaceOwner } = useWorkspacePermissions();

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<WorkspaceMember | null>(null);
  const [newRole, setNewRole] = useState<WorkspaceRole>("member");
  /**
   * The member row pending removal, held whole rather than as a scatter of
   * extracted fields.
   *
   * That is deliberate. The bug this page carried was an *id* picked out of the
   * row at selection time — the `workspace_member` PK where the endpoint wanted
   * the user — and by the time it reached the request there was nothing left to
   * check it against. Keeping the row means the call site reads
   * `.userId` from the thing it is acting on, and the confirmation can name the
   * member fully.
   */
  const [memberPendingRemoval, setMemberPendingRemoval] = useState<WorkspaceMember | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);
  const [copyingLinkId, setCopyingLinkId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [copyFallbackUrl, setCopyFallbackUrl] = useState<
    { invitationId: string; url: string } | null
  >(null);

  // `useWorkspace()` throws when there is no workspace, so `workspace` is
  // non-nullable here — no optional chain or `?? ""` fallback to write.
  const workspaceId = workspace.id;
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

  const columns = getMemberColumns({
    canManageWorkspace,
    isWorkspaceOwner,
    onChangeRole: (row) => {
      setSelectedMember(row);
      setNewRole(parseWorkspaceRole(row.role));
      setRoleDialogOpen(true);
    },
    onRemoveMember: (row) => {
      setMemberPendingRemoval(row);
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

  /**
   * Copy the shareable `/invite/:token` URL for one pending invitation.
   *
   * Why the members page needs this at all: invitation email is best-effort.
   * It bounces, it lands in spam, and self-hosted deployments without a mail
   * provider send nothing at all — before this control there was no way to
   * get the link to the invitee, which is half of why inviting anyone new was
   * a dead end (audit finding 03). This is the manual delivery channel that
   * always works.
   *
   * The URL is fetched on demand rather than carried in the invitations list,
   * because the token inside it is a bearer credential and the list response
   * is fetched and cached on every visit to this page (audit finding 04).
   *
   * `navigator.clipboard` throws in non-secure contexts and when the
   * permission is denied, so failure falls back to rendering the URL in a
   * selectable field instead of leaving the admin with nothing.
   */
  async function handleCopyInviteLink(invitationId: string) {
    setCopyFallbackUrl(null);
    setCopyingLinkId(invitationId);
    try {
      const { url } = await api.get<{ url: string }>(
        `/api/workspaces/${workspaceId}/invitations/${invitationId}/link`,
      );
      try {
        await navigator.clipboard.writeText(url);
        setCopiedLinkId(invitationId);
        // Clear the confirmation so a second copy still gives visible feedback.
        window.setTimeout(() => setCopiedLinkId(null), 2000);
      } catch {
        setCopyFallbackUrl({ invitationId, url });
      }
    } catch (err) {
      toast(apiErrorMessage(err, "Failed to get the invite link."), { variant: "error" });
    } finally {
      setCopyingLinkId(null);
    }
  }

  async function handleRevokeInvitation(invitationId: string) {
    try {
      await api.delete(`/api/workspaces/${workspaceId}/invitations/${invitationId}`);
      toast("Invitation revoked.", { variant: "success" });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.invitations(workspaceId) });
    } catch (err) {
      toast(apiErrorMessage(err, "Failed to revoke invitation."), { variant: "error" });
    }
  }

  /**
   * Promote or demote a member.
   *
   * ## Why the URL carries `userId` and not `id`
   *
   * A member row is `{ id, userId, … }`, where `id` is the `workspace_member`
   * table's primary key and `userId` is the person. The endpoint is
   * `PATCH /api/workspaces/:workspaceId/members/:userId` and its handler
   * matches on `workspaceMember.userId` — so interpolating `id` here addressed
   * a user id that does not exist, and every request came back
   * `404 {"error":"Member not found"}`. Because the failure was a plausible
   * 404 rather than a crash, the page looked healthy while role changes and
   * removals had never once worked from the UI.
   *
   * Both fields are non-null strings of the same shape, so nothing about the
   * types catches the swap. The rule is simply: `id` identifies the row (React
   * keys, list diffing), `userId` identifies the person (every API path).
   */
  async function handleChangeRole() {
    if (!selectedMember) return;
    setUpdatingRole(true);
    setRoleError(null);
    try {
      await api.patch(`/api/workspaces/${workspaceId}/members/${selectedMember.userId}`, {
        role: newRole,
      });
      toast("Role updated.", { variant: "success" });
      setRoleDialogOpen(false);
      setSelectedMember(null);
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspaceId) });
    } catch (err) {
      setRoleError(apiErrorMessage(err, "Failed to update role."));
    } finally {
      setUpdatingRole(false);
    }
  }

  /**
   * Remove a member from the workspace.
   *
   * Addressed by `userId` for the reason spelled out on `handleChangeRole` —
   * the endpoint is keyed by user, not by membership row.
   *
   * ## Why the server's message is shown verbatim
   *
   * Removal has a governance policy behind it, and every refusal names a rule
   * the admin can act on: "Only the workspace owner can remove an admin" (403),
   * "Cannot remove the workspace owner" (403), "Cannot remove yourself from the
   * workspace" (400), and a 409 when the target's role changed mid-edit and the
   * write was refused rather than applied to a row nobody had checked. Folding
   * all of those into one "Failed to remove member." toast told the admin only
   * that something went wrong, leaving them to retry the exact same thing.
   * `ApiError.message` already carries the server's text — the generic string
   * survives only as the fallback for a transport failure, which is the one
   * case where there is no server message to show.
   */
  async function handleRemoveMember() {
    if (!memberPendingRemoval) return;
    setRemoving(true);
    try {
      // `.userId`, not `.id` — the endpoint is keyed by user, not by row.
      await api.delete(
        `/api/workspaces/${workspaceId}/members/${memberPendingRemoval.userId}`,
      );
      toast("Member removed.", { variant: "success" });
      setMemberPendingRemoval(null);
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspaceId) });
    } catch (err) {
      toast(apiErrorMessage(err, "Failed to remove member."), { variant: "error" });
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

        {/*
          No `loading` prop: the roster arrives with the workspace context, and
          `WorkspaceGuard` does not render this route until that has resolved.
          The prop used to read `loading={!workspace}`, which is a constant
          `false` — `useWorkspace()` throws rather than returning a nullish
          workspace — so it described a state this table can never be in.
        */}
        <DataTable
          data={members}
          columns={columns}
          rowKey={(row) => row.id}
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
              <Stack key={invitation.id} gap="r6">
                <Row justify="between" align="center" className="py-r5">
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
                    <Row gap="r6" align="center">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={copyingLinkId === invitation.id}
                        onClick={() => void handleCopyInviteLink(invitation.id)}
                        aria-label={`Copy invite link for ${invitation.email ?? "invitation"}`}
                      >
                        {copiedLinkId === invitation.id ? (
                          <>
                            <Check size={14} aria-hidden="true" className="mr-r6" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Link2 size={14} aria-hidden="true" className="mr-r6" />
                            {copyingLinkId === invitation.id ? "Copying..." : "Copy link"}
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRevokeInvitation(invitation.id)}
                      >
                        Revoke
                      </Button>
                    </Row>
                  )}
                </Row>
                {copyFallbackUrl?.invitationId === invitation.id && (
                  <Stack gap="r6" className="pb-r5">
                    <Text variant="body-3" color="muted">
                      Couldn&apos;t copy automatically — select and copy this link:
                    </Text>
                    <Input
                      readOnly
                      value={copyFallbackUrl.url}
                      aria-label={`Invite link for ${invitation.email ?? "invitation"}`}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </Stack>
                )}
              </Stack>
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
            canGrantAdmin={isWorkspaceOwner}
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
            canGrantAdmin={isWorkspaceOwner}
            newRole={newRole}
            onNewRoleChange={setNewRole}
            updatingRole={updatingRole}
            roleError={roleError}
            onSubmit={() => void handleChangeRole()}
          />

          <RemoveMemberDialog
            open={memberPendingRemoval !== null}
            onClose={() => {
              if (!removing) {
                setMemberPendingRemoval(null);
              }
            }}
            onConfirm={() => void handleRemoveMember()}
            removing={removing}
            memberName={memberPendingRemoval?.user.name ?? ""}
            memberEmail={memberPendingRemoval?.user.email ?? ""}
            workspaceName={workspace.name}
          />
        </>
      )}
    </Container>
  );
}

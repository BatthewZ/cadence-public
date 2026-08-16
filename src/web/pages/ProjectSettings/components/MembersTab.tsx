import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCog, UserMinus } from "lucide-react";
import { type FormEvent, useState } from "react";

import { type ProjectRole, ROLE_LABELS } from "@/shared/types/roles";
import { Field, Label, Select } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  Dialog,
  DropdownMenu,
  Text,
} from "@/web/components/ui";
import type { useToast } from "@/web/components/ui/ToastContext";
import { type ProjectMember, type useProject } from "@/web/contexts/ProjectContext";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { queryKeys } from "@/web/lib/query-keys";
import { getRoleBadgeVariant } from "@/web/util/role-display";

import { ChangeRoleDialog } from "./ChangeRoleDialog";
import { ProjectRoleField } from "./ProjectRoleField";
import type { AddProjectMemberInput } from "./types";

export function MembersTab({
  projectId,
  project,
  refetch,
  toast,
}: {
  projectId: string;
  project: ReturnType<typeof useProject>["project"];
  refetch: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [addRole, setAddRole] = useState<ProjectRole>("member");
  const [roleMember, setRoleMember] = useState<ProjectMember | null>(null);
  const [newRole, setNewRole] = useState<ProjectRole>("member");

  // Used only to hide "Change Role" on the viewer's own row, mirroring the
  // server's refusal to let anyone re-role themselves (see `updateMemberRole`
  // in `projects.handlers.ts` for why that refusal exists). An affordance, not
  // an authority: the endpoint enforces it regardless of what this renders.
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  const workspaceId = project?.workspaceId ?? "";
  const { data: workspaceMembersData } = useQuery({
    queryKey: queryKeys.workspaces.members(workspaceId),
    queryFn: () =>
      api.get<{ members: { userId: string; user: { name: string; email: string } }[] }>(
        `/api/workspaces/${workspaceId}/members`
      ),
    enabled: !!workspaceId,
  });
  const workspaceMembers = (workspaceMembersData?.members ?? []).map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
  }));

  // Fetch project members from the dedicated endpoint
  interface ProjectMemberApiResponse {
    id: string;
    userId: string;
    role: string;
    addedAt: string;
    user: { id: string; name: string; email: string; image?: string | null };
  }
  const { data: projectMembersData } = useQuery({
    queryKey: queryKeys.projects.members(projectId),
    queryFn: () =>
      api.get<{ members: ProjectMemberApiResponse[] }>(
        `/api/projects/${projectId}/members`
      ),
    enabled: !!projectId,
  });
  const members: ProjectMember[] = (projectMembersData?.members ?? []).map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    role: m.role as ProjectMember["role"],
    joinedAt: m.addedAt,
  }));

  const qc = useQueryClient();
  const {
    mutateAsync: addMember,
    isPending: adding,
    error: addErrorObj,
  } = useMutation({
    mutationFn: (input: AddProjectMemberInput) =>
      api.post<unknown>(`/api/projects/${projectId}/members`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects.members(projectId) });
    },
  });
  const addError = addErrorObj?.message ?? null;

  const {
    mutateAsync: updateMemberRole,
    isPending: updatingRole,
    error: roleErrorObj,
    reset: resetRoleError,
  } = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ProjectRole }) =>
      api.patch<unknown>(`/api/projects/${projectId}/members/${userId}`, { role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects.members(projectId) });
    },
  });
  // Surfaced in the dialog rather than as a toast, because every way this can
  // fail is a statement about the choice still on screen — a 403 for re-roling
  // yourself, a 404 for a member removed underneath you, or the 409 the server
  // raises when the row moved while the dialog was open. A toast would dismiss
  // the reason while leaving the stale form up.
  const roleError = roleErrorObj?.message ?? null;

  const columns: ColumnDef<ProjectMember>[] = [
    {
      key: "name",
      header: "Member",
      render: (row) => (
        <Row gap="r5" align="center">
          <Avatar src={row.image} name={row.name} size="sm" />
          <Text variant="body-2" weight="semibold">
            {row.name}
          </Text>
        </Row>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (row) => (
        <Text variant="body-2" color="secondary">
          {row.email}
        </Text>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => <Badge variant={getRoleBadgeVariant(row.role)}>{ROLE_LABELS[row.role]}</Badge>,
    },
    {
      key: "joinedAt",
      header: "Joined",
      render: (row) => (
        <Text variant="body-3" color="muted">
          {new Date(row.joinedAt).toLocaleDateString()}
        </Text>
      ),
    },
    {
      key: "actions",
      header: "",
      width: 48,
      align: "right",
      render: (row) => {
        // Hidden on your own row only. Every other project member is
        // re-rollable by any project admin — projects have no rank hierarchy,
        // deliberately, so this is the whole of the client-side rule (see
        // `updateMemberRole` in `projects.handlers.ts`).
        const showChangeRole = row.userId !== currentUserId;

        // `DropdownMenu.Item.index` is the item's slot in this menu's
        // `listRef`, which drives arrow-key roving focus and typeahead, so it
        // must be 0-based and gapless per menu. Counting only the items
        // actually rendered keeps that true now that "Change Role" can be
        // absent — a hardcoded `1` would leave a hole at slot 0 on the
        // viewer's own row and open keyboard navigation onto a null element.
        const removeIndex = showChangeRole ? 1 : 0;

        return (
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="sm" aria-label={`Actions for ${row.name}`}>
                ...
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {showChangeRole && (
                <DropdownMenu.Item
                  index={0}
                  icon={<UserCog size={14} />}
                  onSelect={() => openRoleDialog(row)}
                >
                  Change Role
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item index={removeIndex} variant="danger" icon={<UserMinus size={14} />} onSelect={() => void handleRemoveMember(row.userId)}>
                Remove
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        );
      },
    },
  ];

  async function handleAddMember(e: FormEvent) {
    e.preventDefault();
    if (!selectedUserId) return;

    try {
      await addMember({ userId: selectedUserId, role: addRole });
      toast("Member added to project.", { variant: "success" });
      setAddDialogOpen(false);
      setSelectedUserId("");
      setAddRole("member");
      refetch();
    } catch {
      // error is captured by the mutation state
    }
  }

  /**
   * Open the role dialog on `member`, pre-selected to the role they already
   * hold.
   *
   * Pre-selecting the current role is what makes the picker readable — it shows
   * where the member is now, so the admin is choosing a destination rather than
   * re-stating the whole assignment from a blank field. `resetRoleError` clears
   * any error left by a previous attempt; without it, a failed change on one
   * member greets the next member's dialog with a stale red alert about someone
   * else.
   */
  function openRoleDialog(member: ProjectMember) {
    resetRoleError();
    setRoleMember(member);
    setNewRole(member.role);
  }

  async function handleChangeRole() {
    if (!roleMember) return;

    try {
      await updateMemberRole({ userId: roleMember.userId, role: newRole });
      // "…'s role is now Viewer", not "…is now viewer": the possessive avoids
      // the a/an article problem across "admin" and the other two, and keeping
      // the label's own casing matches the badge the row now shows.
      toast(`${roleMember.name}'s role is now ${ROLE_LABELS[newRole]}.`, {
        variant: "success",
      });
      setRoleMember(null);
    } catch {
      // Left open on purpose: `roleError` renders the server's reason inside
      // the dialog, next to the selection that has to change.
    }
  }

  async function handleRemoveMember(userId: string) {
    try {
      await api.delete(`/api/projects/${projectId}/members/${userId}`);
      toast("Member removed.", { variant: "success" });
      void qc.invalidateQueries({ queryKey: queryKeys.projects.members(projectId) });
    } catch {
      toast("Failed to remove member.", { variant: "error" });
    }
  }

  // Filter out members already in the project
  const existingUserIds = new Set(members.map((m) => m.userId));
  const availableMembers = workspaceMembers.filter((m) => !existingUserIds.has(m.userId));

  return (
    <>
      <Row justify="between" align="center">
        <Text variant="body-2" color="secondary">
          {members.length} {members.length === 1 ? "member" : "members"}
        </Text>
        <Button variant="primary" size="md" onClick={() => setAddDialogOpen(true)}>
          Add Member
        </Button>
      </Row>

      <DataTable data={members} columns={columns} rowKey={(row) => row.id} loading={!project} />

      <ChangeRoleDialog
        open={roleMember !== null}
        onClose={() => setRoleMember(null)}
        member={roleMember}
        newRole={newRole}
        onNewRoleChange={setNewRole}
        updating={updatingRole}
        error={roleError}
        onSubmit={() => void handleChangeRole()}
      />

      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)}>
        <form onSubmit={(e) => void handleAddMember(e)}>
          <Stack gap="r4">
            <Text variant="h5">Add Member</Text>

            <Field>
              <Label htmlFor="add-proj-member">Select Workspace Member</Label>
              <Select
                id="add-proj-member"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                <option value="">Select a member...</option>
                {availableMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name} ({member.email})
                  </option>
                ))}
              </Select>
            </Field>

            <ProjectRoleField id="add-proj-role" value={addRole} onChange={setAddRole} />

            {addError && <Alert variant="error">{addError}</Alert>}

            <Row gap="r4" justify="end">
              <Button
                variant="ghost"
                size="md"
                type="button"
                onClick={() => setAddDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={adding}>
                {adding ? "Adding..." : "Add Member"}
              </Button>
            </Row>
          </Stack>
        </form>
      </Dialog>
    </>
  );
}

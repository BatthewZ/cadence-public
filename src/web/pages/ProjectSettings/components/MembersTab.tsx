import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMinus } from "lucide-react";
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
import { queryKeys } from "@/web/lib/query-keys";
import { getRoleBadgeVariant } from "@/web/util/role-display";

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
      render: (row, index) => (
        <DropdownMenu>
          <DropdownMenu.Trigger>
            <Button variant="ghost" size="sm">
              ...
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item index={index} variant="danger" icon={<UserMinus size={14} />} onSelect={() => void handleRemoveMember(row.userId)}>
              Remove
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu>
      ),
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

            <Field>
              <Label htmlFor="add-proj-role">Role</Label>
              <Select
                id="add-proj-role"
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as ProjectRole)}
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </Select>
            </Field>

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

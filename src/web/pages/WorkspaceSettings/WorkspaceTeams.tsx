import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { Container, Row, Stack } from "@/web/components/layout";
import {
  Accordion,
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateTitle,
  Text,
} from "@/web/components/ui";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import { useToast } from "@/web/components/ui/ToastContext";
import { useWorkspace, type WorkspaceTeam } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

import { AddTeamMemberDialog } from "./components/AddTeamMemberDialog";
import { DeleteTeamDialog } from "./components/DeleteTeamDialog";
import { TeamCard } from "./components/TeamCard";
import { TeamFormDialog } from "./components/TeamFormDialog";
import { SettingsNav } from "./SettingsNav";

interface CreateTeamInput {
  name: string;
  description: string;
}

interface UpdateTeamInput {
  name: string;
  description: string;
}

export default function WorkspaceTeams() {
  const { workspace, members, refetch } = useWorkspace();
  useDocumentTitle(`${workspace.name} — Teams`);
  const { toast } = useToast();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<WorkspaceTeam | null>(null);

  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");

  const workspaceId = workspace?.id ?? "";

  const qc = useQueryClient();

  const { data: teamsData } = useQuery({
    queryKey: queryKeys.workspaces.teams(workspaceId),
    queryFn: () => api.get<{ teams: WorkspaceTeam[] }>(`/api/workspaces/${workspaceId}/teams`),
    enabled: !!workspaceId,
    staleTime: 5 * 60_000,
  });

  const { mutateAsync: createTeam, isPending: creating, error: createErrorObj } = useMutation({
    mutationFn: (input: CreateTeamInput) =>
      api.post<unknown>(`/api/workspaces/${workspaceId}/teams`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.teams(workspaceId) });
    },
  });
  const createError = createErrorObj?.message ?? null;

  const { mutateAsync: updateTeam, isPending: updating, error: updateErrorObj } = useMutation({
    mutationFn: (input: UpdateTeamInput) =>
      api.patch<unknown>(`/api/workspaces/${workspaceId}/teams/${selectedTeam?.id ?? ""}`, input),
    onMutate: async (input) => {
      const key = queryKeys.workspaces.teams(workspaceId);
      await qc.cancelQueries({ queryKey: key });
      const previousTeams = qc.getQueryData<{ teams: WorkspaceTeam[] }>(key);
      if (selectedTeam) {
        qc.setQueryData<{ teams: WorkspaceTeam[] }>(key, (old) =>
          old
            ? { teams: old.teams.map((t) => (t.id === selectedTeam.id ? { ...t, name: input.name, description: input.description } : t)) }
            : old,
        );
      }
      return { previousTeams };
    },
    onError: (_err, _input, context) => {
      if (context?.previousTeams) {
        qc.setQueryData(queryKeys.workspaces.teams(workspaceId), context.previousTeams);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.teams(workspaceId) });
      if (selectedTeam) {
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.teamDetail(workspaceId, selectedTeam.id) });
      }
    },
  });
  const updateError = updateErrorObj?.message ?? null;

  const teams = teamsData?.teams ?? [];

  function openCreateDialog() {
    setTeamName("");
    setTeamDescription("");
    setCreateDialogOpen(true);
  }

  function openEditDialog(team: WorkspaceTeam) {
    setSelectedTeam(team);
    setTeamName(team.name);
    setTeamDescription(team.description ?? "");
    setEditDialogOpen(true);
  }

  function openDeleteDialog(team: WorkspaceTeam) {
    setSelectedTeam(team);
    setDeleteDialogOpen(true);
  }

  function openAddMemberDialog(team: WorkspaceTeam) {
    setSelectedTeam(team);
    setSelectedMemberId("");
    setAddMemberDialogOpen(true);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;

    try {
      await createTeam({
        name: teamName.trim(),
        description: teamDescription.trim(),
      });
      toast("Team created.", { variant: "success" });
      setCreateDialogOpen(false);
      refetch();
    } catch {
      // error is captured by the mutation state
    }
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    if (!teamName.trim() || !selectedTeam) return;

    try {
      await updateTeam({
        name: teamName.trim(),
        description: teamDescription.trim(),
      });
      toast("Team updated.", { variant: "success" });
      setEditDialogOpen(false);
      setSelectedTeam(null);
      refetch();
    } catch {
      // error is captured by the mutation state
    }
  }

  async function handleDelete() {
    if (!selectedTeam) return;
    try {
      const { api } = await import("@/web/lib/api/client");
      await api.delete(`/api/workspaces/${workspaceId}/teams/${selectedTeam.id}`);
      toast("Team deleted.", { variant: "success" });
      setDeleteDialogOpen(false);
      setSelectedTeam(null);
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.teams(workspaceId) });
    } catch {
      toast("Failed to delete team.", { variant: "error" });
    }
  }

  async function handleAddMember() {
    if (!selectedTeam || !selectedMemberId) return;
    try {
      const { api } = await import("@/web/lib/api/client");
      await api.post(`/api/workspaces/${workspaceId}/teams/${selectedTeam.id}/members`, {
        userId: selectedMemberId,
      });
      toast("Member added to team.", { variant: "success" });
      setAddMemberDialogOpen(false);
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.teams(workspaceId) });
      if (selectedTeam) {
        void qc.invalidateQueries({ queryKey: queryKeys.workspaces.teamDetail(workspaceId, selectedTeam.id) });
      }
      setSelectedTeam(null);
    } catch {
      toast("Failed to add member.", { variant: "error" });
    }
  }

  return (
    <Container size="lg">
      <Stack gap="r3" className="py-r2">
        <Breadcrumbs>
          <Breadcrumbs.Item href={`/w/${workspace.slug}/dashboard`}>{workspace.name}</Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/w/${workspace.slug}/settings`}>Settings</Breadcrumbs.Item>
          <Breadcrumbs.Item current>Teams</Breadcrumbs.Item>
        </Breadcrumbs>
        <Text variant="h3">Workspace Settings</Text>
        <SettingsNav basePath={`/w/${workspace.slug}/settings`} />

        <Row justify="between" align="center">
          <Text variant="h4">Teams</Text>
          <Button variant="primary" size="md" onClick={openCreateDialog}>
            + Create Team
          </Button>
        </Row>

        {teams.length === 0 ? (
          <EmptyState size="md">
            <EmptyStateTitle>No teams yet</EmptyStateTitle>
            <EmptyStateDescription>
              Create teams to organize workspace members into groups.
            </EmptyStateDescription>
            <EmptyStateActions>
              <Button variant="primary" size="md" onClick={openCreateDialog}>
                Create Your First Team
              </Button>
            </EmptyStateActions>
          </EmptyState>
        ) : (
          <Accordion mode="single">
            {teams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                workspaceId={workspaceId}
                onEdit={() => openEditDialog(team)}
                onDelete={() => openDeleteDialog(team)}
                onAddMember={() => openAddMemberDialog(team)}
              />
            ))}
          </Accordion>
        )}
      </Stack>

      {/* Create Team Dialog */}
      <TeamFormDialog
        mode="create"
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        teamName={teamName}
        onTeamNameChange={setTeamName}
        teamDescription={teamDescription}
        onTeamDescriptionChange={setTeamDescription}
        loading={creating}
        error={createError}
        onSubmit={(e) => void handleCreate(e)}
      />

      {/* Edit Team Dialog */}
      <TeamFormDialog
        mode="edit"
        open={editDialogOpen}
        onClose={() => {
          setEditDialogOpen(false);
          setSelectedTeam(null);
        }}
        teamName={teamName}
        onTeamNameChange={setTeamName}
        teamDescription={teamDescription}
        onTeamDescriptionChange={setTeamDescription}
        loading={updating}
        error={updateError}
        onSubmit={(e) => void handleEdit(e)}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteTeamDialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setSelectedTeam(null);
        }}
        onConfirm={() => void handleDelete()}
        teamName={selectedTeam?.name}
      />

      {/* Add Member Dialog */}
      <AddTeamMemberDialog
        open={addMemberDialogOpen}
        onClose={() => {
          setAddMemberDialogOpen(false);
          setSelectedTeam(null);
        }}
        teamName={selectedTeam?.name}
        members={members}
        selectedMemberId={selectedMemberId}
        onSelectedMemberIdChange={setSelectedMemberId}
        onAddMember={() => void handleAddMember()}
      />
    </Container>
  );
}

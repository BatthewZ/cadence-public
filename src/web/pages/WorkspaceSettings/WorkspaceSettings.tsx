import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Theme } from "@/shared/types/theme";
import { Field, Input, Label, Textarea } from "@/web/components/form";
import { Container, Row, Stack } from "@/web/components/layout";
import { Alert, Button, Card, Dialog, Text } from "@/web/components/ui";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import { ThemeGrid } from "@/web/components/ui/ThemeGrid";
import { useToast } from "@/web/components/ui/ToastContext";
import { useWorkspace, type Workspace } from "@/web/contexts/WorkspaceContext";
import { useWorkspacePermissions } from "@/web/hooks/use-permissions";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { queryKeys } from "@/web/lib/query-keys";

import { SettingsNav } from "./SettingsNav";

interface UpdateWorkspaceInput {
  name: string;
  slug: string;
  description: string;
}

export default function WorkspaceSettings() {
  const { workspace, members, refetch } = useWorkspace();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { canManageWorkspace, canDeleteWorkspace } = useWorkspacePermissions();
  const { data: session } = useSession();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // Sync form fields when workspace data arrives or changes
  const [prevWorkspaceId, setPrevWorkspaceId] = useState<string | null>(null);
  if (workspace && workspace.id !== prevWorkspaceId) {
    setPrevWorkspaceId(workspace.id);
    setName(workspace.name);
    setSlug(workspace.slug);
    setDescription(workspace.description ?? "");
  }

  const qc = useQueryClient();

  // Determine if current user is owner or admin
  const currentUserId = session?.user?.id;
  const currentMember = members.find((m) => m.userId === currentUserId);
  const canEditTheme = currentMember?.role === "owner" || currentMember?.role === "admin";

  const { mutateAsync: updateWorkspace, isPending: saving, error: saveErrorObj } = useMutation({
    mutationFn: (input: UpdateWorkspaceInput) =>
      api.patch<unknown>(`/api/workspaces/${workspace?.id ?? ""}`, input),
    onMutate: async (input) => {
      const key = queryKeys.workspaces.detail(workspace?.id ?? "");
      await qc.cancelQueries({ queryKey: key });
      const previousData = qc.getQueryData(key);
      qc.setQueryData(
        key,
        (old: { workspace: Workspace } | undefined) =>
          old ? { workspace: { ...old.workspace, name: input.name, slug: input.slug, description: input.description } } : old,
      );
      return { previousData };
    },
    onError: (_err, _input, context) => {
      if (context?.previousData) {
        qc.setQueryData(queryKeys.workspaces.detail(workspace?.id ?? ""), context.previousData);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspace?.id ?? "") });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
  const saveError = saveErrorObj?.message ?? null;

  const { mutate: updateTheme, isPending: themeSaving } = useMutation({
    mutationFn: (theme: Theme | null) =>
      api.patch(`/api/workspaces/${workspace.id}`, { theme }),
    onMutate: async (newTheme) => {
      await qc.cancelQueries({ queryKey: queryKeys.workspaces.detail(workspace.id) });
      const previousData = qc.getQueryData(queryKeys.workspaces.detail(workspace.id));
      qc.setQueryData(
        queryKeys.workspaces.detail(workspace.id),
        (old: { workspace: Workspace } | undefined) =>
          old ? { workspace: { ...old.workspace, theme: newTheme } } : old,
      );
      return { previousData };
    },
    onError: (_err, _newTheme, context) => {
      if (context?.previousData) {
        qc.setQueryData(queryKeys.workspaces.detail(workspace.id), context.previousData);
      }
      toast("Failed to update theme.", { variant: "error" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspace.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      toast("Workspace theme updated.", { variant: "success" });
      refetch();
    },
  });

  const { mutateAsync: deleteWorkspace, isPending: deleting, error: deleteErrorObj } = useMutation({
    mutationFn: () =>
      api.delete<unknown>(`/api/workspaces/${workspace?.id ?? ""}`),
  });
  const deleteError = deleteErrorObj?.message ?? null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      await updateWorkspace({ name: name.trim(), slug, description: description.trim() });
      toast("Workspace settings updated.", { variant: "success" });
      refetch();
    } catch {
      // error is captured by the mutation state
    }
  }

  async function handleDelete() {
    if (confirmText !== "DELETE") return;

    try {
      await deleteWorkspace();
      toast("Workspace deleted.", { variant: "success" });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      void navigate("/workspaces");
    } catch {
      // error is captured by the mutation state
    }
  }

  function handleDeleteDialogClose() {
    setDeleteDialogOpen(false);
    setConfirmText("");
  }

  const activeTheme = (workspace.theme ?? "default") as Theme;

  return (
    <Container size="lg">
      <Stack gap="r3" className="py-r2">
        <Breadcrumbs>
          <Breadcrumbs.Item href={`/w/${workspace.slug}/dashboard`}>{workspace.name}</Breadcrumbs.Item>
          <Breadcrumbs.Item current>Settings</Breadcrumbs.Item>
        </Breadcrumbs>
        <Text variant="h3">Workspace Settings</Text>
        <SettingsNav basePath={`/w/${workspace.slug}/settings`} />

        <Card>
          <form onSubmit={(e) => void handleSubmit(e)}>
            <Stack gap="r4">
              <Text variant="h5">General</Text>

              {!canManageWorkspace && (
                <Alert variant="info">
                  You do not have permission to edit workspace settings.
                </Alert>
              )}

              <Field>
                <Label htmlFor="ws-name">Workspace Name</Label>
                <Input
                  id="ws-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Workspace"
                  readOnly={!canManageWorkspace}
                  className={!canManageWorkspace ? "bg-surface-2 cursor-not-allowed" : ""}
                />
              </Field>

              <Field>
                <Label htmlFor="ws-slug">URL</Label>
                <Input
                  id="ws-slug"
                  type="text"
                  value={slug}
                  readOnly
                  className="bg-surface-2 cursor-not-allowed"
                />
                <Text variant="body-3" color="muted">
                  The workspace URL cannot be changed after creation.
                </Text>
              </Field>

              <Field>
                <Label htmlFor="ws-description">Description</Label>
                <Textarea
                  id="ws-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this workspace for?"
                  readOnly={!canManageWorkspace}
                  className={!canManageWorkspace ? "bg-surface-2 cursor-not-allowed" : ""}
                />
              </Field>

              {saveError && <Alert variant="error">{saveError}</Alert>}

              {canManageWorkspace && (
                <Button type="submit" variant="primary" size="md" disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              )}
            </Stack>
          </form>
        </Card>

        {canEditTheme && (
          <Card>
            <Stack gap="r4">
              <Row gap="r5" align="center">
                <Palette size={18} className="text-accent" />
                <Text variant="h5">Workspace Theme</Text>
              </Row>
              <Text variant="body-2" color="secondary">
                Choose a theme for all workspace members. This theme applies across the workspace
                unless a project specifies its own override.
              </Text>
              <ThemeGrid
                activeTheme={activeTheme}
                onSelect={(t) => updateTheme(t === "default" ? null : t)}
                disabled={themeSaving}
              />
            </Stack>
          </Card>
        )}

        {canDeleteWorkspace && (
          <Card className="border border-status-error/30">
            <Stack gap="r4">
              <Text variant="h5" className="text-status-error">
                Danger Zone
              </Text>
              <Text variant="body-2" color="secondary">
                This will permanently delete the workspace and all its data. This action cannot be
                undone.
              </Text>
              <div>
                <Button variant="danger" size="md" onClick={() => setDeleteDialogOpen(true)}>
                  Delete Workspace
                </Button>
              </div>
            </Stack>
          </Card>
        )}
      </Stack>

      {canDeleteWorkspace && (
        <Dialog open={deleteDialogOpen} onClose={handleDeleteDialogClose}>
          <Stack gap="r4" className="p-r2">
            <Text variant="h5" weight="semibold">Delete Workspace</Text>
            <Text variant="body-2" color="secondary">
              This will permanently delete the workspace and all associated projects, tasks, and
              members. Type <strong>DELETE</strong> to confirm.
            </Text>

            <Field>
              <Label htmlFor="confirmDeleteWorkspace">Confirmation</Label>
              <Input
                id="confirmDeleteWorkspace"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type DELETE to confirm"
              />
            </Field>

            {deleteError && <Alert variant="error">{deleteError}</Alert>}

            <Row gap="r4" justify="end" className="pt-r3">
              <Button variant="ghost" size="md" onClick={handleDeleteDialogClose}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="md"
                onClick={() => void handleDelete()}
                disabled={confirmText !== "DELETE" || deleting}
              >
                {deleting ? "Deleting..." : "Delete Workspace"}
              </Button>
            </Row>
          </Stack>
        </Dialog>
      )}
    </Container>
  );
}

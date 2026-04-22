import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, ImagePlus, X } from "lucide-react";
import { type FormEvent, useCallback, useRef, useState } from "react";
import type { useNavigate } from "react-router-dom";

import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_SIZE } from "@/shared/schemas/upload";
import { Checkbox, Field, Input, Label, Select, Textarea } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import {
  Alert,
  Button,
  Card,
  Dialog,
  Text,
  Tooltip,
} from "@/web/components/ui";
import { IconDisplay } from "@/web/components/ui/IconDisplay";
import { IconPicker } from "@/web/components/ui/IconPicker";
import type { useToast } from "@/web/components/ui/ToastContext";
import type { useProject } from "@/web/contexts/ProjectContext";
import { useProjectCover } from "@/web/hooks/use-project-cover";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { formatBytes } from "@/web/util/format";

import type { UpdateProjectInput } from "./types";

export function GeneralTab({
  projectId,
  project,
  refetch,
  updateProject,
  toast,
  navigate,
}: {
  projectId: string;
  project: ReturnType<typeof useProject>["project"];
  refetch: () => void;
  updateProject: ReturnType<typeof useProject>["updateProject"];
  toast: ReturnType<typeof useToast>["toast"];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "completed">("active");
  const [budget, setBudget] = useState<string>("");
  const [icon, setIcon] = useState<string | null>(null);
  const [autoAssignCreator, setAutoAssignCreator] = useState(false);
  const [iconDialogOpen, setIconDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [coverValidationError, setCoverValidationError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const {
    coverUrl,
    uploading: coverUploading,
    handleUpload: handleCoverUpload,
    handleRemove: handleCoverRemove,
  } = useProjectCover(
    projectId,
    project.coverImageKey,
    project.coverUnsplash,
    updateProject,
    () => {
      toast("Failed to remove cover image.", { variant: "error" });
      refetch();
    },
    () => {
      toast("Failed to apply Unsplash cover.", { variant: "error" });
      refetch();
    },
  );

  const qc = useQueryClient();

  const {
    mutateAsync: patchProject,
    isPending: saving,
    error: saveErrorObj,
  } = useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      api.patch<unknown>(`/api/projects/${projectId}`, input),
    onMutate: async (input) => {
      const key = queryKeys.projects.detail(projectId);
      const wpKey = queryKeys.workspaces.projects(project.workspaceId);
      await qc.cancelQueries({ queryKey: key });
      await qc.cancelQueries({ queryKey: wpKey });
      const previousData = qc.getQueryData(key);
      const previousWorkspaceProjects = qc.getQueryData(wpKey);
      updateProject(input);
      // Optimistically update sidebar project list
      if (input.name) {
        qc.setQueryData(wpKey, (old: { projects: Array<{ id: string; name: string }> } | undefined) =>
          old
            ? { projects: old.projects.map((p) => (p.id === projectId ? { ...p, name: input.name } : p)) }
            : old,
        );
      }
      return { previousData, previousWorkspaceProjects };
    },
    onError: (_err, _input, context) => {
      if (context?.previousData) {
        qc.setQueryData(queryKeys.projects.detail(projectId), context.previousData);
      }
      if (context?.previousWorkspaceProjects) {
        qc.setQueryData(queryKeys.workspaces.projects(project.workspaceId), context.previousWorkspaceProjects);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.projects(project.workspaceId) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(project.workspaceId) });
    },
  });
  const saveError = saveErrorObj?.message ?? null;

  const {
    mutateAsync: deleteProject,
    isPending: deleting,
    error: deleteErrorObj,
  } = useMutation({
    mutationFn: () => api.delete<unknown>(`/api/projects/${projectId}`),
  });
  const deleteError = deleteErrorObj?.message ?? null;

  // Sync form fields when project data arrives or changes
  const [prevProjectId, setPrevProjectId] = useState<string | null>(null);
  if (project && project.id !== prevProjectId) {
    setPrevProjectId(project.id);
    setName(project.name);
    setDescription(project.description ?? "");
    setStatus(project.status);
    setBudget(project.budget != null ? String(project.budget / 100) : "");
    setIcon(project.icon ?? null);
    setAutoAssignCreator(project.autoAssignCreator ?? false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    const budgetCents = budget.trim() === "" ? null : Math.round(parseFloat(budget) * 100);
    if (budgetCents !== null && (isNaN(budgetCents) || budgetCents < 0)) return;

    try {
      await patchProject({
        name: name.trim(),
        description: description.trim(),
        status,
        budget: budgetCents,
        autoAssignCreator,
      });
      toast("Project settings updated.", { variant: "success" });
      refetch();
    } catch {
      // error is captured by the mutation state
    }
  }

  const handleIconChange = useCallback(
    async (newIcon: string | null) => {
      setIcon(newIcon);
      // Persist to API and optimistically update project detail cache
      updateProject({ icon: newIcon });
      // Also optimistically update the workspace projects cache (drives sidebar)
      const wpKey = queryKeys.workspaces.projects(project.workspaceId);
      qc.setQueryData(wpKey, (old: { projects: Array<{ id: string; icon?: string | null }> } | undefined) =>
        old
          ? { projects: old.projects.map((p) => (p.id === projectId ? { ...p, icon: newIcon } : p)) }
          : old,
      );
      try {
        await api.patch(`/api/projects/${projectId}`, { icon: newIcon });
      } catch {
        // Revert on failure by re-syncing with server
        toast("Failed to update icon.", { variant: "error" });
        refetch();
        void qc.invalidateQueries({ queryKey: wpKey });
      }
    },
    [projectId, project.workspaceId, updateProject, qc, toast, refetch]
  );

  const handleCoverFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";

      if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
        setCoverValidationError(
          `File type "${file.type || "unknown"}" is not allowed. Accepted: ${ALLOWED_IMAGE_TYPES.join(", ")}.`
        );
        return;
      }
      if (file.size > MAX_UPLOAD_SIZE) {
        setCoverValidationError(
          `File is too large (${formatBytes(file.size)}). Maximum size is ${formatBytes(MAX_UPLOAD_SIZE)}.`
        );
        return;
      }

      setCoverValidationError(null);
      handleCoverUpload(file);
    },
    [handleCoverUpload]
  );

  async function handleDelete() {
    if (confirmText !== "DELETE") return;

    try {
      await deleteProject();
      toast("Project deleted.", { variant: "success" });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      void navigate("/workspaces");
    } catch {
      // error is captured by the mutation state
    }
  }

  const coverAcceptString = ALLOWED_IMAGE_TYPES.join(",");

  return (
    <>
      <Card>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <Stack gap="r4">
            <Field>
              <Label htmlFor="proj-name">Project Name</Label>
              <Row gap="r5" align="center">
                <Tooltip content={icon ? `Icon: ${icon}` : "Choose an icon"}>
                  <button
                    type="button"
                    onClick={() => setIconDialogOpen(true)}
                    className="shrink-0 inline-flex items-center justify-center py-r5 px-r5 rounded-md border border-dashed border-border-secondary bg-surface-0 hover:bg-surface-2 active:bg-surface-3 active:scale-95 duration-fast cursor-pointer ring-2 ring-transparent focus-visible:ring-border-focus focus-visible:ring-offset-2 data-has-icon:border-solid data-has-icon:border-border-strong"
                    aria-label={icon ? `Change icon (${icon})` : "Choose icon"}
                    data-has-icon={icon ? "" : undefined}
                  >
                    {icon ? (
                      <IconDisplay name={icon} size={24} />
                    ) : (
                      <FolderKanban size={24} className="text-fg-muted" />
                    )}
                  </button>
                </Tooltip>
                <Input
                  id="proj-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Project"
                  className="flex-1"
                />
              </Row>
            </Field>

            <Field>
              <Label htmlFor="proj-desc">Description</Label>
              <Textarea
                id="proj-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project about?"
              />
            </Field>

            <Field>
              <Label htmlFor="proj-status">Status</Label>
              <Select
                id="proj-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as "active" | "archived" | "completed")}
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="completed">Completed</option>
              </Select>
            </Field>

            <Field>
              <Label htmlFor="proj-budget">Budget</Label>
              <Row gap="r5" align="center">
                <Text variant="body-2" color="muted">$</Text>
                <Input
                  id="proj-budget"
                  type="number"
                  min="0"
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="0.00"
                  className="flex-1"
                />
              </Row>
              <Text variant="body-3" color="muted">
                Set a budget to track spending against task costs. Leave empty for no budget.
              </Text>
            </Field>

            <Field>
              <Row gap="r4" align="center">
                <Checkbox
                  id="proj-auto-assign"
                  checked={autoAssignCreator}
                  onChange={(e) => setAutoAssignCreator(e.target.checked)}
                />
                <Label htmlFor="proj-auto-assign" className="mb-0 cursor-pointer">
                  Auto-assign tasks to creator
                </Label>
              </Row>
              <Text variant="body-3" color="muted">
                When enabled, new tasks are automatically assigned to whoever creates them.
              </Text>
            </Field>

            <Field>
              <Label>Cover Image</Label>
              <input
                ref={coverInputRef}
                type="file"
                accept={coverAcceptString}
                onChange={handleCoverFileChange}
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
              />
              <Row gap="r5" align="center">
                {coverUrl ? (
                  <>
                    <div className="h-12 w-24 rounded-md overflow-hidden bg-surface-1 shrink-0">
                      <img
                        src={coverUrl}
                        alt="Cover preview"
                        className="h-full w-full object-cover"
                        style={{ objectPosition: `center ${project.coverImagePosition ?? 50}%` }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => coverInputRef.current?.click()}
                      disabled={coverUploading}
                    >
                      {coverUploading ? "Uploading..." : "Change"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { void handleCoverRemove(); }}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={coverUploading}
                  >
                    <ImagePlus size={16} className="mr-1" />
                    {coverUploading ? "Uploading..." : "Add cover image"}
                  </Button>
                )}
              </Row>
              {coverValidationError && (
                <Text variant="body-3" className="text-status-error">
                  {coverValidationError}
                </Text>
              )}
            </Field>

            {saveError && <Alert variant="error">{saveError}</Alert>}

            <Button type="submit" variant="primary" size="md" disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </Stack>
        </form>
      </Card>

      <Card className="border border-status-error/30">
        <Stack gap="r4">
          <Text variant="h5" className="text-status-error">
            Danger Zone
          </Text>
          <Text variant="body-2" color="secondary">
            Permanently delete this project and all its tasks. This action cannot be undone.
          </Text>
          <div>
            <Button variant="danger" size="md" onClick={() => setDeleteDialogOpen(true)}>
              Delete Project
            </Button>
          </div>
        </Stack>
      </Card>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setConfirmText("");
        }}
      >
        <Stack gap="r4" className="p-r2">
          <Text variant="h5" weight="semibold">Delete Project</Text>
          <Text variant="body-2" color="secondary">
            This will permanently delete the project and all associated tasks. Type{" "}
            <strong>DELETE</strong> to confirm.
          </Text>

          <Field>
            <Label htmlFor="confirmDeleteProject">Confirmation</Label>
            <Input
              id="confirmDeleteProject"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
            />
          </Field>

          {deleteError && <Alert variant="error">{deleteError}</Alert>}

          <Row gap="r4" justify="end" className="pt-r3">
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setDeleteDialogOpen(false);
                setConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void handleDelete()}
              disabled={confirmText !== "DELETE" || deleting}
            >
              {deleting ? "Deleting..." : "Delete Project"}
            </Button>
          </Row>
        </Stack>
      </Dialog>

      <Dialog open={iconDialogOpen} onClose={() => setIconDialogOpen(false)}>
        <Stack gap="r4">
          <Row justify="between" align="center">
            <Text variant="h5">Choose Icon</Text>
            <button
              type="button"
              onClick={() => setIconDialogOpen(false)}
              className="inline-flex items-center justify-center rounded-md p-r5 text-fg-secondary hover:bg-surface-2 active:bg-surface-3 duration-fast cursor-pointer"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </Row>
          <Text variant="body-2" color="secondary">
            Select an icon to represent this project in navigation and breadcrumbs.
          </Text>
          <IconPicker
            value={icon}
            onChange={(newIcon) => {
              void handleIconChange(newIcon);
              if (newIcon !== null) {
                setIconDialogOpen(false);
              }
            }}
            portal={false}
          />
          {icon && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleIconChange(null);
                setIconDialogOpen(false);
              }}
            >
              Clear icon
            </Button>
          )}
        </Stack>
      </Dialog>
    </>
  );
}

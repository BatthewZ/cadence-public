import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Input } from "@/web/components/form/Input";
import { Row, Stack } from "@/web/components/layout";
import { Button, Dialog, Text } from "@/web/components/ui";
import { useToast } from "@/web/components/ui/ToastContext";
import { useWorkspace, type WorkspaceProject } from "@/web/contexts/WorkspaceContext";
import { apiErrorMessage } from "@/web/lib/api/client";
import { sendWrite } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";

export function RenameProjectDialog({
  renameTarget,
  onClose,
  onRenamed,
}: {
  renameTarget: WorkspaceProject | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { workspace } = useWorkspace();
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    if (renameTarget) {
      setRenameName(renameTarget.name);
    }
  }, [renameTarget]);

  async function handleRename() {
    if (!renameTarget) return;
    const trimmed = renameName.trim();
    if (!trimmed || trimmed === renameTarget.name) {
      onClose();
      return;
    }
    setRenaming(true);
    const projectId = renameTarget.id;
    const listKey = queryKeys.workspaces.projects(workspace.id);
    const detailKey = queryKeys.projects.detail(projectId);
    const previousList = qc.getQueryData(listKey);
    const previousDetail = qc.getQueryData(detailKey);
    qc.setQueryData(listKey, (old: { projects: WorkspaceProject[] } | undefined) =>
      old
        ? { projects: old.projects.map((p) => (p.id === projectId ? { ...p, name: trimmed } : p)) }
        : old
    );
    qc.setQueryData(detailKey, (old: { project: { name: string } } | undefined) =>
      old ? { ...old, project: { ...old.project, name: trimmed } } : old
    );
    try {
      const result = await sendWrite({
        method: "PATCH",
        path: `/api/projects/${projectId}`,
        body: { name: trimmed },
        label: `Rename project “${renameTarget.name}”`,
      });
      toast("Project renamed", { variant: "success" });
      onClose();
      if (result.status === "sent") onRenamed();
    } catch (err) {
      qc.setQueryData(listKey, previousList);
      qc.setQueryData(detailKey, previousDetail);
      toast(apiErrorMessage(err, "Failed to rename project"), { variant: "error" });
    } finally {
      setRenaming(false);
    }
  }

  return (
    <Dialog
      open={renameTarget !== null}
      onClose={() => {
        if (!renaming) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleRename();
        }}
      >
        <Stack gap="r4">
          <Text variant="h5">Rename Project</Text>
          <Input
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Project name"
            maxLength={100}
            autoFocus
          />
          <Row gap="r4" justify="end">
            <Button variant="ghost" type="button" onClick={() => onClose()} disabled={renaming}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={!renameName.trim() || renameName.trim() === renameTarget?.name || renaming}
            >
              {renaming ? "Renaming..." : "Rename"}
            </Button>
          </Row>
        </Stack>
      </form>
    </Dialog>
  );
}

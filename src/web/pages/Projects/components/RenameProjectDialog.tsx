import { useEffect, useState } from "react";

import { Input } from "@/web/components/form/Input";
import { Row, Stack } from "@/web/components/layout";
import {
  Button,
  Dialog,
  Text,
} from "@/web/components/ui";
import { useToast } from "@/web/components/ui/ToastContext";
import type { WorkspaceProject } from "@/web/contexts/WorkspaceContext";
import { api } from "@/web/lib/api/client";

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
    try {
      await api.patch(`/api/projects/${renameTarget.id}`, { name: trimmed });
      toast("Project renamed", { variant: "success" });
      onClose();
      onRenamed();
    } catch {
      toast("Failed to rename project", { variant: "error" });
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
            <Button
              variant="ghost"
              type="button"
              onClick={() => onClose()}
              disabled={renaming}
            >
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

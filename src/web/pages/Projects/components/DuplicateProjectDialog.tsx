import { useState } from "react";

import { Checkbox, Label } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import {
  Button,
  Dialog,
  Text,
} from "@/web/components/ui";
import { useToast } from "@/web/components/ui/ToastContext";
import type { WorkspaceProject } from "@/web/contexts/WorkspaceContext";
import { api } from "@/web/lib/api/client";

export function DuplicateProjectDialog({
  duplicateTarget,
  onClose,
  onDuplicated,
}: {
  duplicateTarget: WorkspaceProject | null;
  onClose: () => void;
  onDuplicated: (projectId: string) => void;
}) {
  const { toast } = useToast();
  const [includeMembers, setIncludeMembers] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  async function handleDuplicate() {
    if (!duplicateTarget) return;
    setDuplicating(true);
    try {
      const result = await api.post<{ project: { id: string } }>(
        `/api/projects/${duplicateTarget.id}/duplicate`,
        { includeMembers },
      );
      toast("Project duplicated", { variant: "success" });
      onDuplicated(result.project.id);
    } catch {
      toast("Failed to duplicate project", { variant: "error" });
    } finally {
      setDuplicating(false);
    }
  }

  return (
    <Dialog
      open={duplicateTarget !== null}
      onClose={() => {
        if (!duplicating) {
          setIncludeMembers(false);
          onClose();
        }
      }}
    >
      <Stack gap="r4">
        <Text variant="h5">Duplicate Project</Text>
        <Text variant="body-2" color="secondary">
          This will create a copy of <strong>{duplicateTarget?.name}</strong> with
          its settings, task groups, and labels. Tasks, comments, and attachments
          will not be copied.
        </Text>
        <Row gap="r4" align="center">
          <Checkbox
            id="include-members"
            checked={includeMembers}
            onChange={(e) => setIncludeMembers(e.target.checked)}
          />
          <Label htmlFor="include-members" className="mb-0 cursor-pointer">
            Include members and their roles
          </Label>
        </Row>
        <Row gap="r4" justify="end">
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setIncludeMembers(false);
              onClose();
            }}
            disabled={duplicating}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => void handleDuplicate()}
            disabled={duplicating}
          >
            {duplicating ? "Duplicating..." : "Duplicate"}
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}

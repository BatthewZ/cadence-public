import type { FormEvent } from "react";

import { Field, Input, Label, Textarea } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import {
  Alert,
  Button,
  Dialog,
  Text,
} from "@/web/components/ui";

interface TeamFormDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onClose: () => void;
  teamName: string;
  onTeamNameChange: (value: string) => void;
  teamDescription: string;
  onTeamDescriptionChange: (value: string) => void;
  loading: boolean;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
}

const CONFIG = {
  create: {
    title: "Create Team",
    submitText: "Create Team",
    loadingText: "Creating...",
    idPrefix: "team",
    namePlaceholder: "Engineering",
    descPlaceholder: "What does this team do?",
  },
  edit: {
    title: "Edit Team",
    submitText: "Save Changes",
    loadingText: "Saving...",
    idPrefix: "edit-team",
    namePlaceholder: undefined,
    descPlaceholder: undefined,
  },
} as const;

export function TeamFormDialog({
  mode,
  open,
  onClose,
  teamName,
  onTeamNameChange,
  teamDescription,
  onTeamDescriptionChange,
  loading,
  error,
  onSubmit,
}: TeamFormDialogProps) {
  const { title, submitText, loadingText, idPrefix, namePlaceholder, descPlaceholder } = CONFIG[mode];

  return (
    <Dialog open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)}>
        <Stack gap="r4">
          <Text variant="h5">{title}</Text>

          <Field>
            <Label htmlFor={`${idPrefix}-name`}>Team Name</Label>
            <Input
              id={`${idPrefix}-name`}
              type="text"
              value={teamName}
              onChange={(e) => onTeamNameChange(e.target.value)}
              placeholder={namePlaceholder}
            />
          </Field>

          <Field>
            <Label htmlFor={`${idPrefix}-desc`}>Description</Label>
            <Textarea
              id={`${idPrefix}-desc`}
              value={teamDescription}
              onChange={(e) => onTeamDescriptionChange(e.target.value)}
              placeholder={descPlaceholder}
            />
          </Field>

          {error && <Alert variant="error">{error}</Alert>}

          <Row gap="r4" justify="end">
            <Button
              variant="ghost"
              size="md"
              type="button"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={loading}>
              {loading ? loadingText : submitText}
            </Button>
          </Row>
        </Stack>
      </form>
    </Dialog>
  );
}

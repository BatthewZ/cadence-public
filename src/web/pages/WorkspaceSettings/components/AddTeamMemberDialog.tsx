import type { FormEvent } from "react";

import { Field, Label, Select } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import {
  Button,
  Dialog,
  Text,
} from "@/web/components/ui";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";

export function AddTeamMemberDialog({
  open,
  onClose,
  teamName,
  members,
  selectedMemberId,
  onSelectedMemberIdChange,
  onAddMember,
}: {
  open: boolean;
  onClose: () => void;
  teamName: string | undefined;
  members: WorkspaceMember[];
  selectedMemberId: string;
  onSelectedMemberIdChange: (value: string) => void;
  onAddMember: () => void;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onAddMember();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <Stack gap="r4">
          <Text variant="h5">Add Member to {teamName}</Text>

          <Field>
            <Label htmlFor="add-team-member">Select Member</Label>
            <Select
              id="add-team-member"
              value={selectedMemberId}
              onChange={(e) => onSelectedMemberIdChange(e.target.value)}
            >
              <option value="">Select a member...</option>
              {members.map((member) => (
                <option key={member.id} value={member.userId}>
                  {member.user.name} ({member.user.email})
                </option>
              ))}
            </Select>
          </Field>

          <Row gap="r4" justify="end">
            <Button
              variant="ghost"
              size="md"
              type="button"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!selectedMemberId}
            >
              Add Member
            </Button>
          </Row>
        </Stack>
      </form>
    </Dialog>
  );
}

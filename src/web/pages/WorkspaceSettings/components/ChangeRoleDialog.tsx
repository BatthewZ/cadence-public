import type { FormEvent } from "react";

import type { WorkspaceRole } from "@/shared/types/roles";
import { Field, Label, Select } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import { Alert, Button, Dialog, Text } from "@/web/components/ui";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";

export function ChangeRoleDialog({
  open,
  onClose,
  selectedMember,
  newRole,
  onNewRoleChange,
  updatingRole,
  roleError,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  selectedMember: WorkspaceMember | null;
  newRole: WorkspaceRole;
  onNewRoleChange: (value: WorkspaceRole) => void;
  updatingRole: boolean;
  roleError: string | null;
  onSubmit: () => void;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <Stack gap="r4">
          <Text variant="h5">Change Role</Text>
          <Text variant="body-2" color="secondary">
            Change the role of <strong>{selectedMember?.user.name}</strong>.
          </Text>

          <Field>
            <Label htmlFor="new-role">New Role</Label>
            <Select
              id="new-role"
              value={newRole}
              onChange={(e) => onNewRoleChange(e.target.value as WorkspaceRole)}
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </Select>
          </Field>

          {roleError && <Alert variant="error">{roleError}</Alert>}

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
              disabled={updatingRole}
            >
              {updatingRole ? "Updating..." : "Update Role"}
            </Button>
          </Row>
        </Stack>
      </form>
    </Dialog>
  );
}

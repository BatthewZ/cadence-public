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
  canGrantAdmin,
  newRole,
  onNewRoleChange,
  updatingRole,
  roleError,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  selectedMember: WorkspaceMember | null;
  /**
   * Whether the viewer may hand out the `admin` role — owner-only on the
   * server, decided by `mayGrantAdmin` in `src/api/lib/workspace-roles.ts`,
   * which exists so one freshly promoted admin cannot mint a peer and strip the
   * rest. The same gate is on `InviteMemberDialog`, because the server applies
   * the same predicate to the invitation door.
   *
   * Offering the option to anyone else produced a guaranteed
   * `403 "Only the workspace owner can grant the admin role"`. This gate is
   * deliberately kept even though `MemberColumns` now shows the "Change Role"
   * item to the owner alone: the dialog is what actually submits the role, so
   * it should not depend on a caller elsewhere having filtered correctly.
   */
  canGrantAdmin: boolean;
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
              {canGrantAdmin && <option value="admin">Admin</option>}
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

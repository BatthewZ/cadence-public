import type { FormEvent } from "react";

import type { WorkspaceRole } from "@/shared/types/roles";
import { Field, Input, Label, Select } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import { Alert, Button, Dialog, Text } from "@/web/components/ui";

export function InviteMemberDialog({
  open,
  onClose,
  inviteEmail,
  onInviteEmailChange,
  inviteRole,
  onInviteRoleChange,
  inviting,
  inviteError,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  inviteEmail: string;
  onInviteEmailChange: (value: string) => void;
  inviteRole: WorkspaceRole;
  onInviteRoleChange: (value: WorkspaceRole) => void;
  inviting: boolean;
  inviteError: string | null;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)}>
        <Stack gap="r4">
          <Text variant="h5">Invite Member</Text>

          <Field>
            <Label htmlFor="invite-email">Email Address</Label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => onInviteEmailChange(e.target.value)}
              placeholder="colleague@example.com"
            />
          </Field>

          <Field>
            <Label htmlFor="invite-role">Role</Label>
            <Select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => onInviteRoleChange(e.target.value as WorkspaceRole)}
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </Select>
          </Field>

          {inviteError && <Alert variant="error">{inviteError}</Alert>}

          <Row gap="r4" justify="end">
            <Button
              variant="ghost"
              size="md"
              type="button"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={inviting}>
              {inviting ? "Sending..." : "Send Invitation"}
            </Button>
          </Row>
        </Stack>
      </form>
    </Dialog>
  );
}

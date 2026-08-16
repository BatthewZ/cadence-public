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
  canGrantAdmin,
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
  /**
   * Whether the viewer may hand out the `admin` role — owner-only on the
   * server, decided by `mayGrantAdmin` in `src/api/lib/workspace-roles.ts`.
   *
   * The identical gate exists on `ChangeRoleDialog`, and it has to exist twice
   * because inviting and promoting are two doors onto the same end state: an
   * admin blocked from promoting a member to admin can otherwise invite a
   * brand-new admin instead. The server closes both with one predicate; if only
   * the promotion dialog gates its option, a workspace admin is shown "Admin"
   * here, submits, and is handed a guaranteed
   * `403 "Only the workspace owner can invite someone as an admin"` — an
   * affordance for something the product refuses.
   */
  canGrantAdmin: boolean;
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
              {canGrantAdmin && <option value="admin">Admin</option>}
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

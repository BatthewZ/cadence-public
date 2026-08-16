import type { FormEvent } from "react";

import type { ProjectRole } from "@/shared/types/roles";
import { Row, Stack } from "@/web/components/layout";
import { Alert, Button, Dialog, Text } from "@/web/components/ui";
import type { ProjectMember } from "@/web/contexts/ProjectContext";

import { ProjectRoleField } from "./ProjectRoleField";

/**
 * Dialog for re-roling an existing project member, submitted to
 * `PATCH /api/projects/:projectId/members/:userId`.
 *
 * ## Why this is not the WorkspaceSettings dialog of the same name
 *
 * The two look alike and are deliberately separate, because the interesting
 * part of each is the option list and the two lists are decided by different
 * authorities. The workspace dialog offers `admin`/`member` and hides `admin`
 * behind `canGrantAdmin` because granting workspace admin is owner-only
 * (`mayGrantAdmin`, `api/lib/workspace-roles.ts`). Projects have no owner tier
 * and no rank hierarchy — every project role is grantable by any project admin,
 * which is what `updateMemberRole` in `projects.handlers.ts` enforces — so the
 * whole of `PROJECT_ROLES` is offered unconditionally. Sharing one component
 * would mean parameterising away exactly the rule each side exists to state,
 * and the shared shell underneath is a `Select` in a form.
 *
 * What IS shared is the project-side picker itself: {@link ProjectRoleField}
 * carries the option list and the per-role description used identically here
 * and in the "Add Member" dialog, so a role's meaning does not depend on which
 * door you came through.
 */
export function ChangeRoleDialog({
  open,
  onClose,
  member,
  newRole,
  onNewRoleChange,
  updating,
  error,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  member: ProjectMember | null;
  newRole: ProjectRole;
  onNewRoleChange: (value: ProjectRole) => void;
  updating: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Stack gap="r4">
          <Text variant="h5">Change Role</Text>
          <Text variant="body-2" color="secondary">
            Change the project role of <strong>{member?.name}</strong>.
          </Text>

          <ProjectRoleField
            id="change-proj-role"
            label="New Role"
            value={newRole}
            onChange={onNewRoleChange}
          />

          {error && <Alert variant="error">{error}</Alert>}

          <Row gap="r4" justify="end">
            <Button variant="ghost" size="md" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={updating}>
              {updating ? "Updating..." : "Update Role"}
            </Button>
          </Row>
        </Stack>
      </form>
    </Dialog>
  );
}

import { PROJECT_ROLES, type ProjectRole, ROLE_LABELS } from "@/shared/types/roles";
import { Field, Label, Select } from "@/web/components/form";
import { Text } from "@/web/components/ui/Text";
import { PROJECT_ROLE_DESCRIPTIONS } from "@/web/util/role-display";

/**
 * The project-role picker, with its option list and its explanatory line.
 *
 * ## Why the description travels with the select
 *
 * Both project role pickers — "Add Member" and "Change Role" — pair the same
 * `<Select>` with the same one-line description of the role currently chosen,
 * and the pairing is the point: "Admin / Member / Viewer" is not
 * self-describing, so a picker that loses its description silently becomes a
 * blind choice between the write boundary and the settings boundary (see
 * {@link PROJECT_ROLE_DESCRIPTIONS}). Keeping them in one component means a
 * third picker cannot get the select without the sentence.
 *
 * ## Why the options are derived, not written out
 *
 * `PROJECT_ROLES` is the same enum the API validates against
 * (`updateProjectMemberRoleSchema`, `addProjectMemberSchema`), so a role added
 * there appears in both dialogs rather than being grantable by the API and
 * invisible in the only UI that grants it.
 *
 * The whole enum is offered unconditionally because projects have no rank
 * hierarchy — every project role is grantable by any project admin, which is
 * what `updateMemberRole` in `projects.handlers.ts` enforces. This is why the
 * workspace-level role picker is NOT this component: there, `admin` is hidden
 * behind `canGrantAdmin` because granting workspace admin is owner-only
 * (`mayGrantAdmin`, `api/lib/workspace-roles.ts`), and parameterising that away
 * would erase exactly the rule each side exists to state.
 */
export function ProjectRoleField({
  id,
  label = "Role",
  value,
  onChange,
}: {
  /** Ties the `<Label>` to the `<Select>`; must be unique per rendered dialog. */
  id: string;
  label?: string;
  value: ProjectRole;
  onChange: (role: ProjectRole) => void;
}) {
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value as ProjectRole)}>
        {PROJECT_ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </Select>
      <Text variant="body-3" color="muted">
        {PROJECT_ROLE_DESCRIPTIONS[value]}
      </Text>
    </Field>
  );
}

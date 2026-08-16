import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { InviteMemberDialog } from "./InviteMemberDialog";

// jsdom does not implement <dialog>; Dialog calls showModal/close directly.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

/**
 * Renders the dialog and returns the values of the role select's options.
 *
 * Reading the options through `querySelectorAll` rather than casting the node to
 * `HTMLSelectElement` is repo precedent: the tests project has a non-`lib.dom`
 * `HTMLElement` in scope, so that cast does not typecheck.
 *
 * The tag assertion is not ceremony. Both tests below judge the dialog by the
 * option values it produces, and "no select rendered at all" produces an empty
 * list — indistinguishable from the correct result of the withholding case.
 * Without this check a dialog that rendered nothing would turn that test green,
 * which is the one thing a test asserting an absence must not do.
 */
function renderRoleOptions(canGrantAdmin: boolean): string[] {
  render(
    <InviteMemberDialog
      open
      onClose={vi.fn()}
      inviteEmail="colleague@example.com"
      onInviteEmailChange={vi.fn()}
      inviteRole="member"
      onInviteRoleChange={vi.fn()}
      canGrantAdmin={canGrantAdmin}
      inviting={false}
      inviteError={null}
      onSubmit={vi.fn()}
    />,
  );
  const select = document.getElementById("invite-role");
  if (select?.tagName !== "SELECT") {
    throw new Error(`expected #invite-role to be a <select>, got ${select?.tagName ?? "nothing"}`);
  }
  return Array.from(select.querySelectorAll("option")).map((option) => option.value);
}

/**
 * Inviting is the SECOND door onto the admin tier, and it needs the same gate as
 * the first.
 *
 * `mayGrantAdmin` (`src/api/lib/workspace-roles.ts`) is applied by both
 * `updateMemberRole` and `createInvitation` precisely because an admin blocked
 * from promoting a member to admin could otherwise invite a brand-new admin
 * instead and reach the identical end state. `ChangeRoleDialog` gained the
 * matching client gate; this dialog did not, so a workspace admin was shown
 * "Admin", submitted, and was handed a guaranteed
 * `403 "Only the workspace owner can invite someone as an admin"`.
 *
 * These assertions mirror `ChangeRoleDialog.test.tsx` deliberately: the two
 * dialogs enforce one server rule, and a divergence between them is exactly the
 * drift that let this one ship ungated.
 */
describe("InviteMemberDialog", () => {
  it("offers the Admin role when the viewer may grant it", () => {
    expect(renderRoleOptions(true)).toEqual(["admin", "member"]);
  });

  it("withholds the Admin role when the viewer may not grant it", () => {
    expect(renderRoleOptions(false)).toEqual(["member"]);
    expect(screen.queryByRole("option", { name: "Admin" })).toBeNull();
  });
});

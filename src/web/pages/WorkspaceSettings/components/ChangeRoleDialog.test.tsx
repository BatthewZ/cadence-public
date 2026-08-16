import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";

import { ChangeRoleDialog } from "./ChangeRoleDialog";

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

const member: WorkspaceMember = {
  id: "member-2",
  userId: "user-2",
  role: "member",
  joinedAt: "2025-02-15T00:00:00.000Z",
  user: { id: "user-2", name: "Bob", email: "bob@test.com", image: undefined },
};

/**
 * Renders the dialog and returns the values of the role select's options.
 *
 * Reading the options through `querySelectorAll` rather than casting the node
 * to `HTMLSelectElement` is repo precedent (see the note in
 * `ImportIcsDialog.test.tsx`): the tests project has a non-`lib.dom`
 * `HTMLElement` in scope, so that cast does not typecheck.
 *
 * The tag assertion is not ceremony. Both tests below judge the dialog by the
 * option values it produces, and "no select rendered at all" produces an empty
 * list — which is indistinguishable from the correct result of the withholding
 * case. Without this check a dialog that rendered nothing would still turn that
 * test green, which is the one thing a test asserting an absence must not do.
 */
function renderRoleOptions(canGrantAdmin: boolean): string[] {
  render(
    <ChangeRoleDialog
      open
      onClose={vi.fn()}
      selectedMember={member}
      canGrantAdmin={canGrantAdmin}
      newRole="member"
      onNewRoleChange={vi.fn()}
      updatingRole={false}
      roleError={null}
      onSubmit={vi.fn()}
    />,
  );
  const select = document.getElementById("new-role");
  if (select?.tagName !== "SELECT") {
    throw new Error(`expected #new-role to be a <select>, got ${select?.tagName ?? "nothing"}`);
  }
  return Array.from(select.querySelectorAll("option")).map((option) => option.value);
}

/**
 * The dialog is what actually submits a role change, so it owns the last word
 * on which roles are offerable — not the menu that happened to open it.
 *
 * Granting `admin` is owner-only on the server (`ADMIN_GRANT_MIN_RANK`, which
 * exists so a single freshly promoted admin cannot mint peers and strip the
 * rest of the roster). Rendering the option unconditionally, as this did,
 * guaranteed a `403 "Only the workspace owner can grant the admin role"` for
 * every admin who used it.
 */
describe("ChangeRoleDialog", () => {
  it("offers the Admin role when the viewer may grant it", () => {
    expect(renderRoleOptions(true)).toEqual(["admin", "member"]);
  });

  it("withholds the Admin role when the viewer may not grant it", () => {
    expect(renderRoleOptions(false)).toEqual(["member"]);
    expect(screen.queryByRole("option", { name: "Admin" })).toBeNull();
  });
});

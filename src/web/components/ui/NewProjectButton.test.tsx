import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCanCreateProject = { value: true };
vi.mock("@/web/hooks/use-permissions", async () => {
  const actual =
    await vi.importActual<typeof import("@/web/hooks/use-permissions")>(
      "@/web/hooks/use-permissions",
    );
  return {
    // The denial copy is imported from the real module rather than restated,
    // so a reworded hint updates this test's expectation with it instead of
    // failing it — the wording is not what is under test here, the wiring is.
    ...actual,
    useWorkspacePermissions: () => ({ canCreateProject: mockCanCreateProject.value }),
  };
});

import { PROJECT_CREATION_DENIED_HINT } from "@/web/hooks/use-permissions";

import { NewProjectButton } from "./NewProjectButton";

/**
 * `NewProjectButton` exists to keep three things that must agree from drifting
 * apart across four call sites: the control is disabled, it says why on hover,
 * and the sentence is the same everywhere.
 *
 * The tooltip half is the part these tests really protect. Disabling a button
 * is the obvious move and nobody forgets it; a disabled `<button>` also stops
 * firing pointer events, so the tooltip silently never opens unless a hover
 * target is wrapped around it. That produces the exact UI this component was
 * written to prevent — a dead button with no stated reason — and it does so
 * without breaking any test that only checks `toBeDisabled()`.
 */
describe("NewProjectButton", () => {
  beforeEach(() => {
    mockCanCreateProject.value = true;
  });

  it("is clickable when the workspace allows project creation", async () => {
    const onClick = vi.fn();
    render(<NewProjectButton onClick={onClick} />);

    await userEvent.click(screen.getByRole("button", { name: /new project/i }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses the caller's label when given one", () => {
    render(<NewProjectButton onClick={vi.fn()} label="Create Project" />);

    expect(screen.getByRole("button", { name: "Create Project" })).toBeInTheDocument();
  });

  it("disables the button when project creation is refused", () => {
    mockCanCreateProject.value = false;
    render(<NewProjectButton onClick={vi.fn()} />);

    expect(screen.getByRole("button", { name: /new project/i })).toBeDisabled();
  });

  it("does not fire onClick when refused", async () => {
    mockCanCreateProject.value = false;
    const onClick = vi.fn();
    render(<NewProjectButton onClick={onClick} />);

    await userEvent.click(screen.getByRole("button", { name: /new project/i }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("explains the refusal on hover", async () => {
    mockCanCreateProject.value = false;
    render(<NewProjectButton onClick={vi.fn()} />);

    // Hovering the WRAPPER, not the button — a disabled button receives no
    // pointer events, so this only passes while the wrapping hover target is
    // in place. Remove the span and the refusal becomes silent.
    await userEvent.hover(screen.getByRole("button", { name: /new project/i }).parentElement!);

    await waitFor(() => {
      expect(screen.getByText(PROJECT_CREATION_DENIED_HINT)).toBeInTheDocument();
    });
  });

  it("shows no tooltip when creation is allowed", async () => {
    render(<NewProjectButton onClick={vi.fn()} />);

    await userEvent.hover(screen.getByRole("button", { name: /new project/i }));

    // An always-on tooltip repeating the button's own label trains people to
    // ignore tooltips on this page — including this one when it matters.
    expect(screen.queryByText(PROJECT_CREATION_DENIED_HINT)).not.toBeInTheDocument();
  });

  it("disables for an unrelated reason without borrowing the permission wording", async () => {
    // The Projects page's loading skeleton passes `disabled`. A "still
    // loading" button must not tell the user they lack permission.
    render(<NewProjectButton onClick={vi.fn()} disabled />);

    const button = screen.getByRole("button", { name: /new project/i });
    expect(button).toBeDisabled();

    await userEvent.hover(button);
    expect(screen.queryByText(PROJECT_CREATION_DENIED_HINT)).not.toBeInTheDocument();
  });
});

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";

// ---------------------------------------------------------------------------
// Mocks — the hook reads the session and the workspace roster, nothing else.
// ---------------------------------------------------------------------------

const mockSessionUserId = { value: "user-2" as string | undefined };
vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: mockSessionUserId.value
      ? { user: { id: mockSessionUserId.value }, session: { id: "sess-1" } }
      : null,
  }),
}));

const mockWorkspaceMembers = { value: [] as WorkspaceMember[] };
const mockWorkspacePolicy = { value: { allowMemberProjectCreation: true } };
vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: {
      id: "ws-1",
      name: "WS",
      slug: "ws",
      // Always a fully-resolved object, matching the wire format — the server
      // applies the defaults before responding, so the hook never sees a
      // partial policy and this mock must not pretend otherwise.
      policy: mockWorkspacePolicy.value,
    },
    members: mockWorkspaceMembers.value,
  }),
}));

import { useProjectPermissions, useWorkspacePermissions } from "./use-permissions";

function member(userId: string, role: string): WorkspaceMember {
  return {
    id: `mem-${userId}`,
    userId,
    role,
    user: { id: userId, name: userId, email: `${userId}@t.co` },
  };
}

const OWNER = member("user-1", "owner");
const PLAIN = member("user-2", "member");

/**
 * `useProjectPermissions` is the client's model of the backend's
 * `resolveProjectAccess`. Its value is entirely in that correspondence: it is
 * not an enforcement point (the server is), it is what every UI gate and every
 * future reader treats as the statement of what the server will allow. A hook
 * whose JSDoc claims to mirror a rule it does not implement is worse than one
 * with no comment, because the divergence is invisible at the call sites.
 */
describe("useProjectPermissions", () => {
  beforeEach(() => {
    mockSessionUserId.value = "user-2";
    mockWorkspaceMembers.value = [OWNER, PLAIN];
  });

  it("elevates workspace owners and admins to project admin", () => {
    mockSessionUserId.value = "user-1";
    const { result } = renderHook(() => useProjectPermissions([]));

    expect(result.current.isProjectAdmin).toBe(true);
    expect(result.current.canEditTasks).toBe(true);
    expect(result.current.canViewProject).toBe(true);
  });

  it("uses the direct project role of a plain workspace member", () => {
    const { result } = renderHook(() =>
      useProjectPermissions([{ userId: "user-2", role: "member" }]),
    );

    expect(result.current.projectRole).toBe("member");
    expect(result.current.canEditTasks).toBe(true);
    expect(result.current.isProjectAdmin).toBe(false);
  });

  it("gives a project viewer read-only access", () => {
    const { result } = renderHook(() =>
      useProjectPermissions([{ userId: "user-2", role: "viewer" }]),
    );

    expect(result.current.canViewProject).toBe(true);
    expect(result.current.canEditTasks).toBe(false);
  });

  it("denies a project member who is no longer a workspace member", () => {
    // The rule the backend added when offboarding turned out to be cosmetic:
    // deleting the `workspace_member` row left every `project_member` row
    // granting read, write and export. Workspace membership is the outer
    // boundary — a project role narrows it and never outlives it. Before this,
    // the hook honoured the orphaned project role and the JSDoc's "mirrors
    // resolveProjectAccess" claim was false.
    mockWorkspaceMembers.value = [OWNER];

    const { result } = renderHook(() =>
      useProjectPermissions([{ userId: "user-2", role: "admin" }]),
    );

    expect(result.current.workspaceRole).toBeNull();
    expect(result.current.projectRole).toBeNull();
    expect(result.current.canViewProject).toBe(false);
    expect(result.current.canEditTasks).toBe(false);
    expect(result.current.isProjectAdmin).toBe(false);
  });

  it("denies a user who is in the workspace but not in the project", () => {
    const { result } = renderHook(() =>
      useProjectPermissions([{ userId: "user-9", role: "admin" }]),
    );

    expect(result.current.canViewProject).toBe(false);
  });

  it("stays permissive while the workspace roster is still loading", () => {
    // An empty roster means "not fetched yet", not "nobody is a member" — a
    // real workspace always contains at least its owner. Reading it as an
    // absent membership would flash restricted UI on every page load, which is
    // the failure this guard exists to prevent. The server enforces regardless.
    mockWorkspaceMembers.value = [];

    const { result } = renderHook(() =>
      useProjectPermissions([{ userId: "user-2", role: "member" }]),
    );

    expect(result.current.canViewProject).toBe(true);
    expect(result.current.canEditTasks).toBe(true);
    expect(result.current.isResolved).toBe(false);
  });

  it("stays permissive while the project roster is still loading", () => {
    const { result } = renderHook(() => useProjectPermissions([]));

    expect(result.current.canViewProject).toBe(true);
    expect(result.current.canEditTasks).toBe(true);
    expect(result.current.isResolved).toBe(false);
  });

  it("reports isResolved only once a decision has actually been made", () => {
    // The permissive defaults cover the grant direction, but `isProjectAdmin`
    // cannot be permissive without flashing admin controls at non-admins — so
    // while loading it is `false`, which is byte-identical to a real refusal.
    // `isResolved` is the only thing separating the two, and a caller that
    // denies without it (as ProjectSettings did) tells a project admin they
    // have no permission and then silently changes its mind.
    //
    // Asserted as a pair on purpose: `isProjectAdmin === false` must hold in
    // BOTH states, so a test that only checked it would pass either way.
    mockWorkspaceMembers.value = [];
    const loading = renderHook(() =>
      useProjectPermissions([{ userId: "user-2", role: "admin" }]),
    );
    expect(loading.result.current.isProjectAdmin).toBe(false);
    expect(loading.result.current.isResolved).toBe(false);

    mockWorkspaceMembers.value = [OWNER, PLAIN];
    const resolved = renderHook(() =>
      useProjectPermissions([{ userId: "user-2", role: "admin" }]),
    );
    expect(resolved.result.current.isProjectAdmin).toBe(true);
    expect(resolved.result.current.isResolved).toBe(true);
  });

  it("marks a genuine refusal as resolved, so the denier can act on it", () => {
    mockWorkspaceMembers.value = [OWNER, PLAIN];
    const { result } = renderHook(() =>
      useProjectPermissions([{ userId: "user-2", role: "viewer" }]),
    );

    expect(result.current.isProjectAdmin).toBe(false);
    expect(result.current.isResolved).toBe(true);
  });
});

describe("useWorkspacePermissions", () => {
  beforeEach(() => {
    mockSessionUserId.value = "user-1";
    mockWorkspaceMembers.value = [OWNER, PLAIN];
  });

  it("marks the owner as owner, admin and manager", () => {
    const { result } = renderHook(() => useWorkspacePermissions());

    expect(result.current.workspaceRole).toBe("owner");
    expect(result.current.isWorkspaceOwner).toBe(true);
    expect(result.current.canDeleteWorkspace).toBe(true);
  });

  it("separates admin from owner", () => {
    // `isWorkspaceOwner` is what the members page uses to keep owner-only
    // actions (granting `admin`, acting on an admin's row) out of an admin's
    // menu, so the two must never collapse into one flag.
    mockWorkspaceMembers.value = [OWNER, member("user-3", "admin")];
    mockSessionUserId.value = "user-3";

    const { result } = renderHook(() => useWorkspacePermissions());

    expect(result.current.isWorkspaceOwner).toBe(false);
    expect(result.current.isWorkspaceAdmin).toBe(true);
    expect(result.current.canManageWorkspace).toBe(true);
    expect(result.current.canDeleteWorkspace).toBe(false);
  });

  it("grants a plain member nothing", () => {
    mockSessionUserId.value = "user-2";
    const { result } = renderHook(() => useWorkspacePermissions());

    expect(result.current.canManageWorkspace).toBe(false);
    expect(result.current.isWorkspaceAdmin).toBe(false);
  });
});

/**
 * `canCreateProject` is the client's mirror of `requireProjectCreation`
 * (`src/api/middleware/authorize.ts`). The server is the enforcement point, so
 * what these tests protect is the *agreement*: a UI that hides the button in a
 * case the server would have allowed is a bug users cannot route around, and
 * one that shows it in a case the server refuses turns a policy into a dead
 * button and a mystery error.
 */
describe("useWorkspacePermissions — canCreateProject", () => {
  beforeEach(() => {
    mockSessionUserId.value = "user-2";
    mockWorkspaceMembers.value = [OWNER, PLAIN];
    mockWorkspacePolicy.value = { allowMemberProjectCreation: true };
  });

  it("lets a member create while the policy is on", () => {
    const { result } = renderHook(() => useWorkspacePermissions());

    expect(result.current.canCreateProject).toBe(true);
  });

  it("refuses a member once the policy is off", () => {
    mockWorkspacePolicy.value = { allowMemberProjectCreation: false };

    const { result } = renderHook(() => useWorkspacePermissions());

    expect(result.current.canCreateProject).toBe(false);
  });

  it.each([
    ["owner", "user-1", OWNER],
    ["admin", "user-3", member("user-3", "admin")],
  ])("exempts the %s from the policy", (_role, userId, roster) => {
    mockWorkspacePolicy.value = { allowMemberProjectCreation: false };
    mockWorkspaceMembers.value = [OWNER, PLAIN, roster];
    mockSessionUserId.value = userId;

    const { result } = renderHook(() => useWorkspacePermissions());

    // Mirrors the server's admin exemption. If this drifted, admins would see
    // no way to create a project in a workspace where they are the only people
    // who can — including no way to reach the setting's effect at all.
    expect(result.current.canCreateProject).toBe(true);
  });

  it("stays permissive while the roster is still loading, even with the policy off", () => {
    mockWorkspacePolicy.value = { allowMemberProjectCreation: false };
    mockWorkspaceMembers.value = [];

    const { result } = renderHook(() => useWorkspacePermissions());

    // An empty roster means "unknown role", not "no role". Denying here would
    // hide New Project from an ADMIN on every hard refresh and then pop it in
    // once members arrived — the flash-of-restricted-UI failure the project
    // hook already documents, arriving at the workspace level for the first
    // time with this flag.
    expect(result.current.isResolved).toBe(false);
    expect(result.current.canCreateProject).toBe(true);
  });

  it("marks a real refusal as resolved so callers may act on it", () => {
    mockWorkspacePolicy.value = { allowMemberProjectCreation: false };

    const { result } = renderHook(() => useWorkspacePermissions());

    // The counterpart to the test above: a UI that waits for `isResolved`
    // before hiding anything needs this to actually become true, or the button
    // never hides and the policy has no visible effect.
    expect(result.current.isResolved).toBe(true);
    expect(result.current.canCreateProject).toBe(false);
  });

  it("carries the flag through to project permissions", () => {
    mockWorkspacePolicy.value = { allowMemberProjectCreation: false };

    const { result } = renderHook(() =>
      useProjectPermissions([{ userId: "user-2", role: "admin" }]),
    );

    // `ProjectPermissions` extends `WorkspacePermissions`, and the Projects
    // page reads the flag from whichever it has to hand. Project-admin on one
    // project must not imply permission to create another — which is the same
    // bypass the server closes on the duplicate route.
    expect(result.current.isProjectAdmin).toBe(true);
    expect(result.current.canCreateProject).toBe(false);
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";

import WorkspaceMembers from "./WorkspaceMembers";

// ---------------------------------------------------------------------------
// jsdom polyfill for HTMLDialogElement (needed by Dialog/ConfirmDialog)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>(
    "@/web/lib/api/client",
  );
  return {
    ...actual,
    api: Object.assign(vi.fn(), {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1", name: "Alice", email: "alice@test.com", image: null },
      session: { id: "sess-1" },
    },
  }),
}));

const mockMembers: WorkspaceMember[] = [
  {
    id: "member-1",
    userId: "user-1",
    role: "owner",
    joinedAt: "2025-01-01T00:00:00.000Z",
    user: { id: "user-1", name: "Alice", email: "alice@test.com", image: undefined },
  },
  {
    id: "member-2",
    userId: "user-2",
    role: "member",
    joinedAt: "2025-02-15T00:00:00.000Z",
    user: { id: "user-2", name: "Bob", email: "bob@test.com", image: undefined },
  },
  {
    id: "member-3",
    userId: "user-3",
    role: "admin",
    joinedAt: "2025-03-10T00:00:00.000Z",
    user: { id: "user-3", name: "Charlie", email: "charlie@test.com", image: undefined },
  },
];

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws-1", name: "Test Workspace", slug: "test-workspace" },
    members: mockMembers,
    projects: [],
    teams: [],
    refetch: vi.fn(),
    refetchProjects: vi.fn(),
    loading: false,
    error: null,
  }),
}));

const mockToast = vi.fn();
vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), dismissAll: vi.fn() }),
}));

/**
 * The viewer's own workspace role, switchable per test.
 *
 * It has to be switchable because the server's member rules are a *hierarchy*,
 * not a single "can manage" bit: only the owner may grant `admin` or act on an
 * admin's row, while an admin may act on plain members only. A mock that could
 * only be an owner would let the UI offer admins buttons that hard-403.
 */
const mockViewerRole = { value: "owner" as "owner" | "admin" | "member" };
vi.mock("@/web/hooks/use-permissions", () => ({
  useWorkspacePermissions: () => ({
    workspaceRole: mockViewerRole.value,
    isWorkspaceOwner: mockViewerRole.value === "owner",
    isWorkspaceAdmin: mockViewerRole.value !== "member",
    canManageWorkspace: mockViewerRole.value !== "member",
    canDeleteWorkspace: mockViewerRole.value === "owner",
  }),
}));

import { api,ApiError } from "@/web/lib/api/client";

const mockGet = api.get as ReturnType<typeof vi.fn>;
const mockPost = api.post as ReturnType<typeof vi.fn>;
const mockPatch = api.patch as ReturnType<typeof vi.fn>;
const mockDelete = api.delete as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={["/w/test-workspace/settings/members"]}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function setupDefaultMocks() {
  mockGet.mockImplementation((url: string): unknown => {
    if (url.includes("/invitations")) {
      return Promise.resolve({ invitations: [] });
    }
    return Promise.resolve({});
  });
}

/**
 * Returns dropdown trigger buttons that have aria-haspopup="menu".
 * This avoids matching nested Button components inside DropdownMenu.Trigger.
 * Uses queryAllByRole to gracefully return empty array when no buttons exist.
 */
function getDropdownTriggers(): HTMLElement[] {
  return screen
    .queryAllByRole("button")
    .filter(
      (btn) =>
        btn.getAttribute("aria-haspopup") === "menu" &&
        btn.textContent?.trim() === "...",
    );
}

/**
 * Tests for the WorkspaceMembers page component. This page is the primary
 * interface for workspace administrators to view members, send invitations,
 * change roles, and remove members. Regressions here directly impact the
 * workspace member-management workflow that admins rely on daily.
 */
describe("WorkspaceMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewerRole.value = "owner";
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Renders DataTable with member columns
  // -----------------------------------------------------------------------

  it("renders DataTable with member column headers", async () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    // Target column headers within the thead
    const thead = await waitFor(() => {
      const el = document.querySelector("thead");
      expect(el).not.toBeNull();
      return el!;
    });

    expect(within(thead).getByText("Member")).toBeInTheDocument();
    expect(within(thead).getByText("Email")).toBeInTheDocument();
    expect(within(thead).getByText("Role")).toBeInTheDocument();
    expect(within(thead).getByText("Joined")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 2. Shows correct member data
  // -----------------------------------------------------------------------

  it("displays member names, emails, role badges, and member count", async () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Names
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();

    // Emails
    expect(screen.getByText("alice@test.com")).toBeInTheDocument();
    expect(screen.getByText("bob@test.com")).toBeInTheDocument();
    expect(screen.getByText("charlie@test.com")).toBeInTheDocument();

    // Role badges — verify within the table body to avoid collisions with
    // column headers and dialog select options
    const tbody = document.querySelector("tbody")!;
    expect(within(tbody).getByText("Owner")).toBeInTheDocument();
    // "Admin" also appears in the invite dialog's role select options, so scope to tbody
    expect(within(tbody).getByText("Admin")).toBeInTheDocument();
    // "Member" appears as both a column header and Bob's role badge
    expect(within(tbody).getByText("Member")).toBeInTheDocument();

    // Member count
    expect(screen.getByText("3 members")).toBeInTheDocument();
  });

  it("renders joined dates for members", async () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Dates rendered via toLocaleDateString
    const date1 = new Date("2025-01-01T00:00:00.000Z").toLocaleDateString();
    const date2 = new Date("2025-02-15T00:00:00.000Z").toLocaleDateString();
    const date3 = new Date("2025-03-10T00:00:00.000Z").toLocaleDateString();

    expect(screen.getByText(date1)).toBeInTheDocument();
    expect(screen.getByText(date2)).toBeInTheDocument();
    expect(screen.getByText(date3)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 3. Invite member dialog
  // -----------------------------------------------------------------------

  it("opens invite dialog with email input and submits invitation", async () => {
    mockPost.mockResolvedValue({});

    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Click the invite button
    const inviteButton = screen.getByRole("button", { name: /invite member/i });
    await user.click(inviteButton);

    // Dialog should open — find the email input by its id since the dialog
    // content is always in the DOM but the dialog becomes open
    const emailInput = await waitFor(() => {
      const input = document.getElementById("invite-email") as HTMLInputElement;
      expect(input).not.toBeNull();
      return input;
    });

    // Fill in the email
    await user.type(emailInput, "new@t.co");

    const sendButton = screen.getByRole("button", { name: /send invitation/i });
    await user.click(sendButton);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/invitations",
        { email: "new@t.co", role: "member" },
      );
    });

    expect(mockToast).toHaveBeenCalledWith("Invitation sent.", { variant: "success" });
  }, 15_000);

  // -----------------------------------------------------------------------
  // 4. Role change dropdown and dialog
  // -----------------------------------------------------------------------

  it("opens role change dialog for non-owner member via dropdown", async () => {
    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    // Find dropdown trigger buttons via aria-haspopup (avoids nested button issue)
    const triggers = getDropdownTriggers();
    // 2 triggers: one for Bob (member) and one for Charlie (admin), none for Alice (owner)
    expect(triggers).toHaveLength(2);

    // Click Bob's action dropdown trigger
    await user.click(triggers[0]);

    // Wait for dropdown content to appear
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /change role/i })).toBeInTheDocument();
    });

    // Click Change Role
    await user.click(screen.getByRole("menuitem", { name: /change role/i }));

    // Role change dialog should open
    await waitFor(() => {
      expect(screen.getByText("Change Role")).toBeInTheDocument();
    });

    // Dialog mentions the member name
    expect(screen.getByText(/change the role of/i)).toBeInTheDocument();
  });

  it("submits role change via the dialog", async () => {
    mockPatch.mockResolvedValue({});

    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    // Open dropdown for Bob
    const triggers = getDropdownTriggers();
    await user.click(triggers[0]);

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /change role/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("menuitem", { name: /change role/i }));

    // Dialog opens with role select
    const roleSelect = await waitFor(() => {
      const el = document.getElementById("new-role");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // Change the role to admin
    await user.selectOptions(roleSelect, "admin");

    // Click Update Role (wrapped in waitFor because Dialog useEffect must run to set open attribute)
    const updateButton = await waitFor(() =>
      screen.getByRole("button", { name: /update role/i }),
    );
    await user.click(updateButton);

    // `user-2`, NOT `member-2`. The member row carries both a
    // `workspace_member` PK (`id`) and the person (`userId`), and
    // `PATCH /api/workspaces/:workspaceId/members/:userId` matches on the
    // latter. Sending the row id addressed a user that does not exist, so this
    // returned 404 "Member not found" every single time — role changes had
    // never worked from the UI. Asserting the exact URL is the only thing that
    // catches it: both ids are non-null strings, the mocked client accepts
    // anything, and the page's own success path still ran.
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/members/user-2",
        { role: "admin" },
      );
    });

    expect(mockToast).toHaveBeenCalledWith("Role updated.", { variant: "success" });
  }, 15_000);

  // -----------------------------------------------------------------------
  // 5. Member action dropdown shows remove option
  // -----------------------------------------------------------------------

  it("shows Remove option in the member action dropdown", async () => {
    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    const triggers = getDropdownTriggers();
    await user.click(triggers[0]);

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /remove/i })).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Remove member shows confirmation dialog
  // -----------------------------------------------------------------------

  it("shows confirmation dialog when Remove is clicked and removes member on confirm", async () => {
    mockDelete.mockResolvedValue({});

    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    // Open action dropdown for Bob
    const triggers = getDropdownTriggers();
    await user.click(triggers[0]);

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /remove/i })).toBeInTheDocument();
    });

    // Click Remove
    await user.click(screen.getByRole("menuitem", { name: /remove/i }));

    // Confirmation dialog should appear with "Remove Member" title
    await waitFor(() => {
      expect(screen.getByText("Remove Member")).toBeInTheDocument();
    });

    // The email is part of the confirmation because display names are not
    // unique — removal is destructive (it deletes the member's project and team
    // grants) and the name alone can identify the wrong row.
    const confirmText = Array.from(document.querySelectorAll("dialog[open]"))
      .find((d) => d.textContent?.includes("Remove Member"))!
      .textContent ?? "";
    expect(confirmText).toContain("Bob");
    expect(confirmText).toContain("bob@test.com");

    // Find the confirm "Remove" button inside the ConfirmDialog's <dialog> element.
    // The dialog may not expose buttons via role queries in jsdom, so we find
    // the dialog element directly and search within it.
    const dialogs = document.querySelectorAll("dialog[open]");
    const confirmDialog = Array.from(dialogs).find((d) =>
      d.textContent?.includes("Remove Member"),
    )!;
    expect(confirmDialog).not.toBeUndefined();

    const confirmButton = within(confirmDialog as HTMLElement).getByText("Remove", {
      selector: "button",
    });
    await user.click(confirmButton);

    // `user-2`, not the `workspace_member` row id — see the role-change test.
    // Removal was 404-ing for the same reason.
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/members/user-2",
      );
    });

    expect(mockToast).toHaveBeenCalledWith("Member removed.", { variant: "success" });
  }, 15_000);

  // -----------------------------------------------------------------------
  // 7. No action buttons for non-admin users
  // -----------------------------------------------------------------------

  it("hides invite button and action dropdowns when user cannot manage workspace", async () => {
    mockViewerRole.value = "member";

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // No invite button
    expect(screen.queryByRole("button", { name: /invite member/i })).toBeNull();

    // No dropdown triggers with aria-haspopup
    const triggers = getDropdownTriggers();
    expect(triggers).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Pending invitations section
  // -----------------------------------------------------------------------

  it("shows pending invitations when they exist", async () => {
    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/invitations")) {
        return Promise.resolve({
          invitations: [
            {
              id: "inv-1",
              email: "pending@example.com",
              role: "member" as const,
              createdAt: "2025-04-01T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("pending@example.com")).toBeInTheDocument();
    });

    expect(screen.getByText("Pending Invitations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument();
  });

  it("shows empty invitations state when no invitations exist", async () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("No pending invitations")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Invite members to your workspace to start collaborating."),
    ).toBeInTheDocument();
  });

  it("does not show action dropdown for the owner member row", async () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Only 2 dropdown triggers (for Bob and Charlie; not for Alice the owner)
    const triggers = getDropdownTriggers();
    expect(triggers).toHaveLength(2);
  });

  it("renders workspace breadcrumbs and settings header", async () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Workspace Settings")).toBeInTheDocument();
    });

    expect(screen.getByText("Settings")).toBeInTheDocument();
    // "Members" appears in both breadcrumbs (current) and SettingsNav tab
    const membersTexts = screen.getAllByText("Members");
    expect(membersTexts.length).toBeGreaterThanOrEqual(2);
  });

  it("revokes an invitation when Revoke button is clicked", async () => {
    mockDelete.mockResolvedValue({});
    mockGet.mockImplementation((url: string): unknown => {
      if (url.includes("/invitations")) {
        return Promise.resolve({
          invitations: [
            {
              id: "inv-1",
              email: "pending@example.com",
              role: "member" as const,
              createdAt: "2025-04-01T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("pending@example.com")).toBeInTheDocument();
    });

    const revokeButton = screen.getByRole("button", { name: /revoke/i });
    await user.click(revokeButton);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/invitations/inv-1",
      );
    });

    expect(mockToast).toHaveBeenCalledWith("Invitation revoked.", { variant: "success" });
  });
  // -----------------------------------------------------------------------
  // Copy invite link — the fallback delivery channel (audit finding 03)
  // -----------------------------------------------------------------------
  //
  // Invitation email is best-effort: it bounces, it lands in spam, and a
  // self-hosted deployment with no mail provider sends nothing at all. Without
  // this control an admin has no way to get the link to the invitee, which is
  // half of why inviting anyone new used to dead-end. The link is fetched on
  // demand rather than carried in the invitations list, because the token
  // inside it is a bearer credential (audit finding 04).

  function mockPendingInvitation(linkResponse?: () => unknown) {
    mockGet.mockImplementation((url: string): unknown => {
      if (url.endsWith("/link")) {
        return linkResponse
          ? linkResponse()
          : Promise.resolve({ url: "https://cadence.test/invite/tok-123" });
      }
      if (url.includes("/invitations")) {
        return Promise.resolve({
          invitations: [
            {
              id: "inv-1",
              email: "pending@example.com",
              role: "member",
              createdAt: "2025-06-01T00:00:00.000Z",
            },
          ],
        });
      }
      return Promise.resolve({});
    });
  }

  async function renderAndClickCopy() {
    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("pending@example.com")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /copy invite link/i }));
    return user;
  }

  it("copies a pending invitation's link to the clipboard on demand", async () => {
    mockPendingInvitation();
    await renderAndClickCopy();

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/invitations/inv-1/link",
      );
    });

    expect(await screen.findByText("Copied")).toBeInTheDocument();
    await expect(window.navigator.clipboard.readText()).resolves.toBe(
      "https://cadence.test/invite/tok-123",
    );
  });

  it("shows the link in a selectable field when the clipboard is unavailable", async () => {
    // `navigator.clipboard` throws in non-secure contexts and when permission
    // is denied. Swallowing that would leave the admin with no link at all —
    // the one thing this control exists to provide.
    mockPendingInvitation();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("clipboard blocked"),
    );

    await renderAndClickCopy();

    const fallback = await screen.findByLabelText(
      "Invite link for pending@example.com",
    );
    expect(fallback).toHaveValue("https://cadence.test/invite/tok-123");
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("reports a failure to fetch the invite link rather than copying nothing", async () => {
    mockPendingInvitation(() => Promise.reject(new Error("nope")));
    await renderAndClickCopy();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("Failed to get the invite link.", {
        variant: "error",
      });
    });
    expect(screen.queryByText("Copied")).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Server error messages on the remove path
  // -----------------------------------------------------------------------

  it("shows the server's reason when a removal is refused", async () => {
    // Removal is governed by real rules, and each refusal names one the admin
    // can act on: "Only the workspace owner can remove an admin" (403),
    // "Cannot remove the workspace owner" (403), "Cannot remove yourself from
    // the workspace" (400), and a 409 when the target's role moved mid-edit.
    // Collapsing all of them into "Failed to remove member." told the admin
    // only that something broke, so the natural next step was to retry the
    // identical action and fail identically.
    mockDelete.mockRejectedValue(
      new ApiError(403, "Only the workspace owner can remove an admin"),
    );

    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Charlie")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Actions for Charlie"));
    await user.click(await screen.findByRole("menuitem", { name: /remove/i }));

    const confirmDialog = await waitFor(() => {
      const found = Array.from(document.querySelectorAll("dialog[open]")).find((d) =>
        d.textContent?.includes("Remove Member"),
      );
      expect(found).not.toBeUndefined();
      return found as HTMLElement;
    });
    await user.click(within(confirmDialog).getByText("Remove", { selector: "button" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "Only the workspace owner can remove an admin",
        { variant: "error" },
      );
    });
    expect(mockToast).not.toHaveBeenCalledWith(
      "Failed to remove member.",
      expect.anything(),
    );
  }, 15_000);

  it("falls back to a generic message when the failure carries no server text", async () => {
    // A dropped connection produces a plain Error, not an ApiError — there is
    // no server message to show, and the user must still be told something.
    mockDelete.mockRejectedValue(new TypeError("Failed to fetch"));

    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Actions for Bob"));
    await user.click(await screen.findByRole("menuitem", { name: /remove/i }));

    const confirmDialog = await waitFor(() => {
      const found = Array.from(document.querySelectorAll("dialog[open]")).find((d) =>
        d.textContent?.includes("Remove Member"),
      );
      expect(found).not.toBeUndefined();
      return found as HTMLElement;
    });
    await user.click(within(confirmDialog).getByText("Remove", { selector: "button" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("Failed to remove member.", {
        variant: "error",
      });
    });
  }, 15_000);

  // -----------------------------------------------------------------------
  // Row actions follow the server's role hierarchy (audit finding 08)
  // -----------------------------------------------------------------------
  //
  // The server now requires the actor to strictly outrank the target: only the
  // owner may act on an admin's row or grant the `admin` role; admins manage
  // plain members. Every control the UI offers outside those bounds is a
  // guaranteed 403, so these assert the menu matches the rules rather than
  // `canManageWorkspace`.

  it("offers an admin viewer Remove on a plain member, and nothing else", async () => {
    mockViewerRole.value = "admin";

    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    // Bob (plain member) is the only row an admin may touch. Charlie's row is
    // an admin row — which is also the shape of the viewer's own row, so this
    // covers "an admin sees actions on themselves" too.
    expect(getDropdownTriggers()).toHaveLength(1);
    expect(screen.queryByLabelText("Actions for Charlie")).toBeNull();
    expect(screen.queryByLabelText("Actions for Alice")).toBeNull();

    await user.click(screen.getByLabelText("Actions for Bob"));

    expect(await screen.findByRole("menuitem", { name: /remove/i })).toBeInTheDocument();
    // No "Change Role": the only roles an API caller can set are `admin`
    // (owner-only to grant) and `member` (what Bob already is), so the dialog
    // would offer an admin nothing but a no-op.
    expect(screen.queryByRole("menuitem", { name: /change role/i })).toBeNull();
  }, 15_000);

  it("keeps both actions for the owner on member and admin rows", async () => {
    // The mirror of the test above: gating on the hierarchy must not quietly
    // take anything away from the owner, who outranks every other row.
    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Charlie")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Actions for Charlie"));

    expect(
      await screen.findByRole("menuitem", { name: /change role/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /remove/i })).toBeInTheDocument();
  }, 15_000);

  it("offers the Admin role only to the owner", async () => {
    // `ChangeRoleDialog` is what actually submits the role, so the option list
    // is gated there as well as on the menu — an admin who reached this dialog
    // could otherwise submit a promotion that always 403s.
    const Wrapper = createWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <WorkspaceMembers />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Actions for Bob"));
    await user.click(await screen.findByRole("menuitem", { name: /change role/i }));

    const roleSelect = await waitFor(() => {
      const el = document.getElementById("new-role") as HTMLSelectElement | null;
      expect(el).not.toBeNull();
      return el!;
    });

    expect(
      Array.from(roleSelect.options).map((o) => o.value),
    ).toEqual(["admin", "member"]);
  }, 15_000);
});

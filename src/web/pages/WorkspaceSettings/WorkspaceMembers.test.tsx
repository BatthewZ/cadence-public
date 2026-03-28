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

const mockCanManageWorkspace = { value: true };
vi.mock("@/web/hooks/use-permissions", () => ({
  useWorkspacePermissions: () => ({
    workspaceRole: "owner" as const,
    isWorkspaceOwner: true,
    isWorkspaceAdmin: true,
    canManageWorkspace: mockCanManageWorkspace.value,
    canDeleteWorkspace: true,
  }),
}));

import { api } from "@/web/lib/api/client";

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
    mockCanManageWorkspace.value = true;
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

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/members/member-2",
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

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/members/member-2",
      );
    });

    expect(mockToast).toHaveBeenCalledWith("Member removed.", { variant: "success" });
  }, 15_000);

  // -----------------------------------------------------------------------
  // 7. No action buttons for non-admin users
  // -----------------------------------------------------------------------

  it("hides invite button and action dropdowns when user cannot manage workspace", async () => {
    mockCanManageWorkspace.value = false;

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
});

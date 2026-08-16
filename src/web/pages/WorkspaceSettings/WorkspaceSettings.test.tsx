import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspaceSettings from "./WorkspaceSettings";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockApiPatch = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiDelete = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@/web/lib/api/client", () => ({
  api: Object.assign(vi.fn(), {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: (...args: unknown[]) => mockApiPatch(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  }),
}));

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1", name: "Alice", email: "alice@test.com", image: null },
      session: { id: "sess-1" },
    },
  }),
}));

const mockToast = vi.fn();

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockRefetch = vi.fn();

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: {
      id: "ws-1",
      name: "Test Workspace",
      slug: "test-workspace",
      description: "A test workspace",
      theme: "default",
      // Always present, matching `WorkspaceDetail` and the wire format: the
      // server resolves every toggle before responding. The card reads
      // `policy.allowMemberProjectCreation` directly and deliberately carries
      // no client-side fallback, because a second copy of the default is the
      // thing that drifts from the server's.
      policy: { allowMemberProjectCreation: true },
    },
    members: [
      {
        id: "m-1",
        userId: "user-1",
        role: "owner",
        user: { id: "user-1", name: "Alice", email: "alice@test.com" },
      },
    ],
    projects: [],
    teams: [],
    refetch: mockRefetch,
    refetchProjects: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock("@/web/hooks/use-permissions", () => ({
  useWorkspacePermissions: () => ({
    workspaceRole: "owner",
    isWorkspaceOwner: true,
    isWorkspaceAdmin: true,
    canManageWorkspace: true,
    canDeleteWorkspace: true,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={["/w/test-workspace/settings"]}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function renderPage() {
  const Wrapper = createWrapper();
  const user = userEvent.setup();
  render(
    <Wrapper>
      <WorkspaceSettings />
    </Wrapper>,
  );
  return { user };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockApiPatch.mockResolvedValue({});
  mockApiDelete.mockResolvedValue({});

  // jsdom does not implement HTMLDialogElement.showModal / .close
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Tests for the WorkspaceSettings page, which provides the form to edit
 * general workspace info (name, slug, description), a theme selector, and
 * the danger zone for workspace deletion.
 *
 * Regressions here can prevent workspace owners from renaming or deleting
 * their workspaces, or cause incorrect data to be sent to the API.
 */
describe("WorkspaceSettings", () => {
  // -----------------------------------------------------------------------
  // 1. Initial render & form pre-population
  // -----------------------------------------------------------------------

  it("renders form with workspace name, slug, and description fields", () => {
    renderPage();

    expect(screen.getByLabelText("Workspace Name")).toBeInTheDocument();
    expect(screen.getByLabelText("URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("renders the Workspace Settings heading", () => {
    renderPage();

    expect(screen.getByText("Workspace Settings")).toBeInTheDocument();
  });

  it("pre-populates form fields with current workspace data", () => {
    renderPage();

    expect(screen.getByLabelText("Workspace Name")).toHaveValue("Test Workspace");
    expect(screen.getByLabelText("URL")).toHaveValue("test-workspace");
    expect(screen.getByLabelText("Description")).toHaveValue("A test workspace");
  });

  // -----------------------------------------------------------------------
  // 2. Slug field is read-only
  // -----------------------------------------------------------------------

  it("renders slug field as read-only", () => {
    renderPage();

    const slugInput = screen.getByLabelText("URL");
    expect(slugInput).toHaveAttribute("readOnly");
  });

  it("displays helper text explaining the slug cannot be changed", () => {
    renderPage();

    expect(
      screen.getByText("The workspace URL cannot be changed after creation."),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 3. Save button triggers update mutation
  // -----------------------------------------------------------------------

  it("renders a Save Changes button", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("calls API patch with correct data on form submission", async () => {
    const { user } = renderPage();

    const nameInput = screen.getByLabelText("Workspace Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed Workspace");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith("/api/workspaces/ws-1", {
        name: "Renamed Workspace",
        slug: "test-workspace",
        description: "A test workspace",
      });
    });
  });

  it("trims name and description before sending", async () => {
    const { user } = renderPage();

    const nameInput = screen.getByLabelText("Workspace Name");
    await user.clear(nameInput);
    await user.type(nameInput, "  Trimmed Name  ");

    const descInput = screen.getByLabelText("Description");
    await user.clear(descInput);
    await user.type(descInput, "  Trimmed Desc  ");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith("/api/workspaces/ws-1", {
        name: "Trimmed Name",
        slug: "test-workspace",
        description: "Trimmed Desc",
      });
    });
  });

  // -----------------------------------------------------------------------
  // 4. Validation: empty name is rejected client-side
  // -----------------------------------------------------------------------

  it("does not submit when name is empty", async () => {
    const { user } = renderPage();

    const nameInput = screen.getByLabelText("Workspace Name");
    await user.clear(nameInput);

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  it("does not submit when name is only whitespace", async () => {
    const { user } = renderPage();

    const nameInput = screen.getByLabelText("Workspace Name");
    await user.clear(nameInput);
    await user.type(nameInput, "   ");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 5. Success toast on save
  // -----------------------------------------------------------------------

  it("calls toast and refetch after successful save", async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("Workspace settings updated.", { variant: "success" });
    });

    expect(mockRefetch).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 6. Error display on save failure
  // -----------------------------------------------------------------------

  it("shows error alert when save fails", async () => {
    mockApiPatch.mockRejectedValueOnce(new Error("Slug already taken"));
    const { user } = renderPage();

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.getByText("Slug already taken")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Loading state during save
  // -----------------------------------------------------------------------

  it("shows Saving... text and disables button during save", async () => {
    let resolveApi!: (value: unknown) => void;
    mockApiPatch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApi = resolve;
        }),
    );

    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    });

    resolveApi({});

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
    });
  });

  // -----------------------------------------------------------------------
  // 8. Theme grid renders and is interactive
  // -----------------------------------------------------------------------

  it("renders Workspace Theme section with theme buttons", () => {
    renderPage();

    expect(screen.getByText("Workspace Theme")).toBeInTheDocument();
    // ThemeGrid renders a button for each theme — verify at least a few
    expect(screen.getByText("Minimal")).toBeInTheDocument();
    expect(screen.getByText("Noir")).toBeInTheDocument();
    expect(screen.getByText("Botanical")).toBeInTheDocument();
  });

  it("calls API patch with selected theme when a theme is clicked", async () => {
    const { user } = renderPage();

    await user.click(screen.getByText("Noir"));

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith("/api/workspaces/ws-1", {
        theme: "noir",
      });
    });
  });

  it("sends null theme when default is selected", async () => {
    const { user } = renderPage();

    // "default" theme maps to "Minimal" label — and since it's already active,
    // clicking it still triggers the onSelect callback
    await user.click(screen.getByText("Minimal"));

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith("/api/workspaces/ws-1", {
        theme: null,
      });
    });
  });

  it("calls toast with success after theme update", async () => {
    const { user } = renderPage();

    await user.click(screen.getByText("Sunset"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("Workspace theme updated.", { variant: "success" });
    });
  });

  // -----------------------------------------------------------------------
  // 9. Danger zone - delete workspace
  // -----------------------------------------------------------------------

  it("renders Danger Zone section with Delete Workspace button", () => {
    renderPage();

    expect(screen.getByText("Danger Zone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Workspace" })).toBeInTheDocument();
  });

  it("opens delete confirmation dialog when Delete Workspace is clicked", async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole("button", { name: "Delete Workspace" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Confirmation")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("Type DELETE to confirm")).toBeInTheDocument();
  });

  it("disables confirm button until DELETE is typed", async () => {
    const { user } = renderPage();

    // The dialog's content is always in the DOM (jsdom doesn't hide <dialog> children).
    // Find the dialog element and its confirm button.
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();

    // The confirm button inside the dialog should be disabled initially
    // because confirmText is empty (confirmText !== "DELETE" is true).
    const dialogDeleteButton = dialog!.querySelector("button[disabled]");
    expect(dialogDeleteButton).not.toBeNull();
    expect(dialogDeleteButton).toBeDisabled();
    expect(dialogDeleteButton).toHaveTextContent("Delete Workspace");

    // Open the dialog so we can interact with the confirmation input
    await user.click(screen.getByRole("button", { name: "Delete Workspace" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Confirmation")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Confirmation"), "DELETE");

    await waitFor(() => {
      // After typing DELETE, the button inside the dialog should be enabled
      const buttons = dialog!.querySelectorAll("button");
      const confirmBtn = Array.from(buttons).find((b) => b.textContent === "Delete Workspace");
      expect(confirmBtn).toBeDefined();
      expect(confirmBtn).toBeEnabled();
    });
  });

  it("calls delete API and navigates away on confirmed delete", async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole("button", { name: "Delete Workspace" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Confirmation")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Confirmation"), "DELETE");

    // Click the confirm button inside the dialog
    const dialog = document.querySelector("dialog");
    const dialogButtons = Array.from(dialog!.querySelectorAll("button"));
    const confirmButton = dialogButtons.find((b) => b.textContent === "Delete Workspace");
    expect(confirmButton).toBeDefined();
    await user.click(confirmButton!);

    await waitFor(() => {
      expect(mockApiDelete).toHaveBeenCalledWith("/api/workspaces/ws-1");
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/workspaces");
    });
  });

  it("does not call delete API if confirm text is not DELETE", async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole("button", { name: "Delete Workspace" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Confirmation")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Confirmation"), "WRONG");

    // The confirm button inside the dialog should remain disabled
    const dialog = document.querySelector("dialog");
    const dialogButtons = Array.from(dialog!.querySelectorAll("button"));
    const confirmButton = dialogButtons.find((b) => b.textContent === "Delete Workspace");
    expect(confirmButton).toBeDefined();
    expect(confirmButton).toBeDisabled();

    expect(mockApiDelete).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 10. Settings navigation renders
  // -----------------------------------------------------------------------

  it("renders the settings navigation with General and Members tabs", () => {
    renderPage();

    // "General" appears both in the nav and as a form section heading.
    // Use getByRole("link") to specifically target the nav links.
    expect(screen.getByRole("link", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Members" })).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 11. Breadcrumbs render
  // -----------------------------------------------------------------------

  it("renders breadcrumbs showing workspace name and Settings", () => {
    renderPage();

    expect(screen.getByText("Test Workspace")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
});

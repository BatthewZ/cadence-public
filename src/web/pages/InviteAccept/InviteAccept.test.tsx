import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockToast = vi.fn();

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockApiGet = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiPost = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>(
    "@/web/lib/api/client",
  );
  const apiFn = Object.assign(vi.fn(), {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  });
  return { ...actual, api: apiFn };
});

let mockSessionData: { user: { id: string; name: string; email: string; image: null }; session: { id: string } } | null = null;

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: mockSessionData,
  }),
}));

import InviteAccept from "./InviteAccept";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function createInvitationDetails(overrides?: Record<string, unknown>) {
  return {
    id: "inv-1",
    email: "alice@test.com",
    role: "member",
    expiresAt: "2026-12-31T00:00:00Z",
    workspace: { id: "ws-1", name: "Acme Corp" },
    invitedBy: { id: "user-2", name: "Bob", email: "bob@test.com" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderInviteAccept(token = "test-token") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[`/invite/${token}`]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/invite/:token" element={<InviteAccept />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { user };
}

/**
 * Tests for the InviteAccept page which handles workspace invitations.
 *
 * This page fetches invitation details by token, displays workspace/inviter
 * information, and allows authenticated users to accept or decline.
 * Unauthenticated users are directed to sign in or register first.
 *
 * Regressions here would break the team onboarding flow, preventing
 * invited members from joining workspaces.
 */
describe("InviteAccept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionData = {
      user: { id: "user-1", name: "Alice", email: "alice@test.com", image: null },
      session: { id: "sess-1" },
    };
    mockApiGet.mockResolvedValue({
      invitation: createInvitationDetails(),
    });
    mockApiPost.mockResolvedValue({ ok: true, workspaceId: "ws-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Initial render - displays invitation details
  // -----------------------------------------------------------------------

  it("renders heading and loading state initially", () => {
    // Make the API hang to observe loading
    mockApiGet.mockReturnValue(new Promise(() => {}));
    renderInviteAccept();

    expect(
      screen.getByRole("heading", { name: "You're Invited!" }),
    ).toBeInTheDocument();
  });

  it("displays invitation details after loading", async () => {
    renderInviteAccept();

    await waitFor(() => {
      expect(screen.getByText("Bob invited you to join")).toBeInTheDocument();
    });

    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Role: member")).toBeInTheDocument();
  });

  it("displays fallback text when inviter name is null", async () => {
    mockApiGet.mockResolvedValue({
      invitation: createInvitationDetails({ invitedBy: null }),
    });
    renderInviteAccept();

    await waitFor(() => {
      expect(
        screen.getByText("Someone invited you to join"),
      ).toBeInTheDocument();
    });
  });

  it("displays fallback text when workspace is null", async () => {
    mockApiGet.mockResolvedValue({
      invitation: createInvitationDetails({ workspace: null }),
    });
    renderInviteAccept();

    await waitFor(() => {
      expect(screen.getByText("a workspace")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Authenticated user - Accept / Decline buttons
  // -----------------------------------------------------------------------

  it("shows accept and decline buttons for authenticated users", async () => {
    renderInviteAccept();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Accept Invitation" }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Decline" }),
    ).toBeInTheDocument();
  });

  it("calls accept API and navigates to /workspaces on accept", async () => {
    const { user } = renderInviteAccept();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Accept Invitation" }),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Accept Invitation" }),
    );

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/invitations/accept",
        { token: "test-token" },
      );
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "You have joined the workspace!",
        { variant: "success" },
      );
    });

    expect(mockNavigate).toHaveBeenCalledWith("/workspaces");
  });

  it("navigates to / when user clicks decline", async () => {
    const { user } = renderInviteAccept();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Decline" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Decline" }));

    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  // -----------------------------------------------------------------------
  // 3. Accept failure
  // -----------------------------------------------------------------------

  it("shows error toast when accept API call fails", async () => {
    mockApiPost.mockRejectedValue(new Error("Server error"));
    const { user } = renderInviteAccept();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Accept Invitation" }),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Accept Invitation" }),
    );

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "Failed to accept invitation. Please try again.",
        { variant: "error" },
      );
    });
  });

  // -----------------------------------------------------------------------
  // 4. Unauthenticated user - Sign In / Create Account
  // -----------------------------------------------------------------------

  it("shows sign in and create account buttons when not authenticated", async () => {
    mockSessionData = null;
    renderInviteAccept();

    await waitFor(() => {
      expect(
        screen.getByText(
          "Sign in or create an account to accept this invitation",
        ),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Sign In" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Account" }),
    ).toBeInTheDocument();
  });

  it("navigates to /login with redirect when unauthenticated user clicks Sign In", async () => {
    mockSessionData = null;
    const { user } = renderInviteAccept();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Sign In" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(mockNavigate).toHaveBeenCalledWith(
      "/login?redirect=%2Finvite%2Ftest-token",
    );
  });

  it("navigates to /register with redirect when unauthenticated user clicks Create Account", async () => {
    mockSessionData = null;
    const { user } = renderInviteAccept();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Create Account" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(mockNavigate).toHaveBeenCalledWith(
      "/register?redirect=%2Finvite%2Ftest-token",
    );
  });

  // -----------------------------------------------------------------------
  // 5. Error state - invalid / expired token
  // -----------------------------------------------------------------------

  it("displays error alert when invitation fetch fails", async () => {
    mockApiGet.mockRejectedValue(new Error("Invitation not found"));
    renderInviteAccept();

    await waitFor(() => {
      expect(screen.getByText("Invitation not found")).toBeInTheDocument();
    });
  });

  it("displays error alert when invitation token is expired", async () => {
    mockApiGet.mockRejectedValue(
      new Error("This invitation has expired"),
    );
    renderInviteAccept();

    await waitFor(() => {
      expect(
        screen.getByText("This invitation has expired"),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Loading state during accept
  // -----------------------------------------------------------------------

  it("disables accept button and shows loading text while accepting", async () => {
    let resolveAccept!: (value: { ok: boolean; workspaceId: string }) => void;
    mockApiPost.mockImplementation(
      () =>
        new Promise<{ ok: boolean; workspaceId: string }>((resolve) => {
          resolveAccept = resolve;
        }),
    );

    const { user } = renderInviteAccept();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Accept Invitation" }),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Accept Invitation" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Accepting..." }),
      ).toBeDisabled();
    });

    resolveAccept({ ok: true, workspaceId: "ws-1" });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/workspaces");
    });
  });
});

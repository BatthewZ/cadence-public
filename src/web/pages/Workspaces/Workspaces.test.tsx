import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/web/contexts/WorkspaceContext";

import Workspaces from "./Workspaces";

// ---------------------------------------------------------------------------
// jsdom polyfills for HTMLDialogElement
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

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>("@/web/lib/api/client");
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
      user: { id: "user-1", name: "Alice Smith", email: "alice@test.com", image: null },
    },
  }),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/web/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock("@/web/hooks/use-invitation-actions", () => ({
  useInvitationActions: () => ({
    accept: vi.fn(),
    dismiss: vi.fn(),
    isAccepting: false,
  }),
}));

vi.mock("@/web/hooks/use-theme", () => ({
  useThemeApplication: vi.fn().mockReturnValue("default"),
  useTheme: () => ({ theme: "default", setTheme: vi.fn(), themes: ["default"] }),
  STORAGE_KEY: "theme",
  THEMES: ["default"],
}));

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useOptionalWorkspace: () => null,
}));

vi.mock("@/web/components/ui/AppShell", () => ({
  useOptionalAppShell: () => null,
}));

vi.mock("@/web/lib/query-client", () => ({
  queryClient: { clear: vi.fn() },
}));

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), dismissAll: vi.fn() }),
}));

import { api } from "@/web/lib/api/client";

type ApiMock = ReturnType<typeof vi.fn> & {
  mockImplementation(fn: (path: string, body?: unknown) => Promise<unknown>): void;
};
const mockGet = api.get as ApiMock;
const mockPost = api.post as ApiMock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    name: "Default Workspace",
    slug: "default-workspace",
    description: undefined,
    memberCount: 1,
    theme: null,
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function renderWorkspaces() {
  const Wrapper = createWrapper();
  const user = userEvent.setup();
  render(
    <Wrapper>
      <Workspaces />
    </Wrapper>,
  );
  return { user };
}

/**
 * Helper to open the create workspace dialog by clicking a trigger button
 * and waiting for the dialog form to appear. Uses fireEvent for interactions
 * inside the native <dialog> element because jsdom's showModal polyfill
 * does not make the dialog content pass userEvent's pointer-event checks.
 */
async function openCreateDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Create Workspace/i }));
  await waitFor(() => {
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });
}

/**
 * Tests for the Workspaces page which serves as the authenticated landing page.
 *
 * This page is the first thing users see after login when they have no
 * workspace context. Regressions here can prevent users from accessing
 * any workspace or creating new ones, effectively locking them out of
 * the application.
 */
describe("Workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no pending invitations
    mockGet.mockImplementation((path: string) => {
      if (path === "/api/invitations/pending") {
        return Promise.resolve({ invitations: [] });
      }
      // Default: return empty workspaces
      if (path === "/api/workspaces") {
        return Promise.resolve({ workspaces: [] });
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Renders workspace cards with name, member count, description
  // -------------------------------------------------------------------------

  it("renders workspace cards with name, member count, and description", async () => {
    const workspaces = [
      makeWorkspace({
        id: "ws-1",
        name: "Engineering",
        slug: "engineering",
        description: "Core engineering team",
        memberCount: 12,
      }),
      makeWorkspace({
        id: "ws-2",
        name: "Marketing",
        slug: "marketing",
        description: "Marketing campaigns",
        memberCount: 5,
      }),
    ];

    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return Promise.resolve({ workspaces });
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Engineering")).toBeInTheDocument();
    });

    expect(screen.getByText("Core engineering team")).toBeInTheDocument();
    expect(screen.getByText("12 members")).toBeInTheDocument();

    expect(screen.getByText("Marketing")).toBeInTheDocument();
    expect(screen.getByText("Marketing campaigns")).toBeInTheDocument();
    expect(screen.getByText("5 members")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2. Shows empty state when user has no workspaces
  // -------------------------------------------------------------------------

  it("shows empty state when user has no workspaces", async () => {
    renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Create your first workspace")).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Workspaces are where your team organizes projects/),
    ).toBeInTheDocument();
    expect(screen.getByText("Get started by creating your first workspace.")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 3. "Create Workspace" button opens create dialog
  // -------------------------------------------------------------------------

  it("Create Workspace button in empty state opens the dialog", async () => {
    const { user } = renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Create your first workspace")).toBeInTheDocument();
    });

    await openCreateDialog(user);

    // Dialog form fields should be visible
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("New Workspace card in grid opens the dialog", async () => {
    const workspaces = [
      makeWorkspace({ id: "ws-1", name: "Engineering", slug: "engineering", memberCount: 3 }),
    ];

    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return Promise.resolve({ workspaces });
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    const { user } = renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Engineering")).toBeInTheDocument();
    });

    await user.click(screen.getByText("New Workspace"));

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Create workspace form validates required fields (name, slug)
  // -------------------------------------------------------------------------

  it("shows validation errors when submitting empty create workspace form", async () => {
    const { user } = renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Create your first workspace")).toBeInTheDocument();
    });

    await openCreateDialog(user);

    // Submit the empty form using fireEvent (dialog elements in jsdom
    // do not pass userEvent pointer-event checks after showModal polyfill)
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });

    // Zod validates all constraints: for an empty slug the regex check is the
    // last error recorded by useFieldErrors (which keeps the final error per field)
    expect(screen.getByText("URL must contain only lowercase letters, numbers, and hyphens")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("auto-generates slug from name input", async () => {
    const { user } = renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Create your first workspace")).toBeInTheDocument();
    });

    await openCreateDialog(user);

    // Use fireEvent.change to set the name value since the input is inside a dialog
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My Cool Workspace" } });

    await waitFor(() => {
      expect(screen.getByLabelText("URL")).toHaveValue("my-cool-workspace");
    });
  });

  it("submits the form with valid data and navigates to new workspace", async () => {
    mockPost.mockResolvedValue({
      workspace: makeWorkspace({ id: "ws-new", name: "My Team", slug: "my-team" }),
    });

    const { user } = renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Create your first workspace")).toBeInTheDocument();
    });

    await openCreateDialog(user);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My Team" } });

    await waitFor(() => {
      expect(screen.getByLabelText("URL")).toHaveValue("my-team");
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/api/workspaces", {
        name: "My Team",
        slug: "my-team",
      });
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/w/my-team/dashboard");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Clicking a workspace card navigates to that workspace
  // -------------------------------------------------------------------------

  it("navigates to the workspace dashboard when a card is clicked", async () => {
    const workspaces = [
      makeWorkspace({ id: "ws-1", name: "Engineering", slug: "engineering", memberCount: 8 }),
    ];

    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return Promise.resolve({ workspaces });
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    const { user } = renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Engineering")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Engineering"));

    expect(mockNavigate).toHaveBeenCalledWith("/w/engineering/dashboard");
  });

  it("saves workspace slug to localStorage when navigating", async () => {
    const workspaces = [
      makeWorkspace({ id: "ws-1", name: "Design", slug: "design", memberCount: 4 }),
    ];

    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return Promise.resolve({ workspaces });
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    const { user } = renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Design")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Design"));

    expect(localStorage.getItem("lastWorkspaceSlug")).toBe("design");
  });

  // -------------------------------------------------------------------------
  // 6. UserMenu is rendered and opens on avatar click
  // -------------------------------------------------------------------------

  it("renders the UserMenu with account menu trigger", async () => {
    const workspaces = [
      makeWorkspace({ id: "ws-1", name: "Test", slug: "test", memberCount: 1 }),
    ];

    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return Promise.resolve({ workspaces });
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Test")).toBeInTheDocument();
    });

    // UserMenu renders an "Account menu" button trigger
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });

  it("opens UserMenu dropdown on click", async () => {
    const workspaces = [
      makeWorkspace({ id: "ws-1", name: "Test", slug: "test", memberCount: 1 }),
    ];

    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return Promise.resolve({ workspaces });
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    const { user } = renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Test")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Account menu" }));

    // Account Settings is only shown when inside a workspace context;
    // the Workspaces page has no active workspace, so only Sign Out appears
    expect(await screen.findByText("Sign Out")).toBeInTheDocument();
    expect(screen.queryByText("Account Settings")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 7. Member count displays correctly
  // -------------------------------------------------------------------------

  it("displays singular 'member' for count of 1", async () => {
    const workspaces = [
      makeWorkspace({ id: "ws-1", name: "Solo", slug: "solo", memberCount: 1 }),
    ];

    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return Promise.resolve({ workspaces });
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Solo")).toBeInTheDocument();
    });

    expect(screen.getByText("1 member")).toBeInTheDocument();
  });

  it("displays plural 'members' for count greater than 1", async () => {
    const workspaces = [
      makeWorkspace({ id: "ws-1", name: "Team", slug: "team", memberCount: 7 }),
    ];

    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return Promise.resolve({ workspaces });
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Team")).toBeInTheDocument();
    });

    expect(screen.getByText("7 members")).toBeInTheDocument();
  });

  it("displays 0 members when memberCount is undefined", async () => {
    const workspaces = [
      makeWorkspace({ id: "ws-1", name: "Empty", slug: "empty", memberCount: undefined }),
    ];

    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return Promise.resolve({ workspaces });
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Empty")).toBeInTheDocument();
    });

    expect(screen.getByText("0 members")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Greeting includes first name
  // -------------------------------------------------------------------------

  it("displays greeting with user first name", async () => {
    renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Create your first workspace")).toBeInTheDocument();
    });

    // The greeting heading contains the first name extracted from "Alice Smith"
    // Use a more specific matcher to avoid matching the UserMenu trigger name
    const greetingHeading = screen.getByRole("heading", { level: 3 });
    expect(greetingHeading.textContent).toContain("Alice");
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  it("shows a loading spinner while workspaces are being fetched", () => {
    // Make the API hang so we can observe loading state
    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return new Promise(() => {});
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    renderWorkspaces();

    // Spinner has role="status"
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  it("shows error alert when workspace fetch fails", async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return Promise.reject(new Error("Network error"));
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Multiple workspace cards show initial letters
  // -------------------------------------------------------------------------

  it("shows workspace initial letter in the card avatar", async () => {
    const workspaces = [
      makeWorkspace({ id: "ws-1", name: "Alpha", slug: "alpha", memberCount: 2 }),
      makeWorkspace({ id: "ws-2", name: "Beta", slug: "beta", memberCount: 3 }),
    ];

    mockGet.mockImplementation((path: string) => {
      if (path === "/api/workspaces") return Promise.resolve({ workspaces });
      if (path === "/api/invitations/pending") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });

    renderWorkspaces();

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    // The initials "A" and "B" should appear in the card avatars
    const alphaCard = screen.getByText("Alpha").closest("button")!;
    expect(within(alphaCard).getByText("A")).toBeInTheDocument();

    const betaCard = screen.getByText("Beta").closest("button")!;
    expect(within(betaCard).getByText("B")).toBeInTheDocument();
  });
});

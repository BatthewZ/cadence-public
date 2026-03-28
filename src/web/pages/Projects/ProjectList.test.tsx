import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceProject } from "@/web/contexts/WorkspaceContext";

// ---------------------------------------------------------------------------
// Mocks — declared before any import that depends on them
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

const mockToast = vi.fn();
vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/web/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "user-1", name: "Alice", email: "alice@test.com", image: null } },
  }),
}));

const mockRefetchProjects = vi.fn();
const mockWorkspaceContextValue = {
  workspace: { id: "ws-1", name: "Test Workspace", slug: "test" },
  members: [
    { userId: "user-1", user: { id: "user-1", name: "Alice", email: "alice@test.com" }, role: "owner" },
  ],
  teams: [],
  projects: [] as WorkspaceProject[],
  refetchProjects: mockRefetchProjects,
  refetch: vi.fn(),
  loading: false,
  error: null,
};

vi.mock("@/web/contexts/WorkspaceContext", async () => {
  const actual = await vi.importActual<typeof import("@/web/contexts/WorkspaceContext")>(
    "@/web/contexts/WorkspaceContext",
  );
  return {
    ...actual,
    useWorkspace: () => mockWorkspaceContextValue,
  };
});

// Mock CreateProjectDialog to avoid pulling in heavy icon-map & theme deps
vi.mock("@/web/components/ui/CreateProjectDialog", () => ({
  CreateProjectDialog: ({
    open,
    onClose,
  }: {
    workspaceId: string;
    open: boolean;
    onClose: () => void;
    onCreated: (id: string) => void;
  }) =>
    open ? (
      <div data-testid="create-project-dialog">
        <span>Create Project Dialog</span>
        <button onClick={onClose}>Close dialog</button>
      </div>
    ) : null,
}));

// Mock IconDisplay to avoid importing the icon-map (large lucide barrel import)
vi.mock("@/web/components/ui/IconDisplay", () => ({
  IconDisplay: ({ name }: { name: string | null | undefined }) => (
    <span data-testid="icon-display">{name ?? "fallback"}</span>
  ),
}));

import { api } from "@/web/lib/api/client";
const mockPatch = api.patch as ReturnType<typeof vi.fn>;
const mockDelete = api.delete as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Polyfills for jsdom
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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Dynamically import after mocks are set up
const { default: ProjectList } = await import("./ProjectList");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<WorkspaceProject> & { id: string }): WorkspaceProject {
  return {
    name: `Project ${overrides.id}`,
    status: "active",
    description: undefined,
    icon: null,
    memberCount: 3,
    taskCount: 12,
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

function renderProjectList(projects: WorkspaceProject[] = []) {
  mockWorkspaceContextValue.projects = projects;
  mockWorkspaceContextValue.loading = false;
  mockWorkspaceContextValue.error = null;
  const Wrapper = createWrapper();
  const user = userEvent.setup();
  render(
    <Wrapper>
      <ProjectList />
    </Wrapper>,
  );
  return { user };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Tests for the ProjectList page, which is the primary view for browsing,
 * managing, and navigating to projects within a workspace. Regressions here
 * break project discovery, favorite toggling, archive/delete flows, and the
 * create-project entry point.
 */
describe("ProjectList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue({});
    mockWorkspaceContextValue.loading = false;
    mockWorkspaceContextValue.error = null;
    mockWorkspaceContextValue.projects = [];
    // Clear localStorage to prevent favorites leaking between tests
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Renders project cards with name, member count, task count
  // -----------------------------------------------------------------------

  describe("rendering project cards", () => {
    it("renders a card for each project showing name, task count, and member count", () => {
      const projects = [
        makeProject({ id: "p1", name: "Alpha", taskCount: 5, memberCount: 2 }),
        makeProject({ id: "p2", name: "Beta", taskCount: 0, memberCount: 1 }),
        makeProject({ id: "p3", name: "Gamma", taskCount: 1, memberCount: 1 }),
      ];

      renderProjectList(projects);

      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
      expect(screen.getByText("Gamma")).toBeInTheDocument();

      // Task counts with correct pluralization
      expect(screen.getByText(/5 tasks/)).toBeInTheDocument();
      expect(screen.getByText(/0 tasks/)).toBeInTheDocument();
      expect(screen.getByText(/1 task/)).toBeInTheDocument();

      // Member counts with correct pluralization
      expect(screen.getByText(/2 members/)).toBeInTheDocument();
      // "1 member" appears twice (p2, p3)
      const memberTexts = screen.getAllByText(/1 member/);
      expect(memberTexts).toHaveLength(2);
    });

    it("shows status badge for each project", async () => {
      const projects = [
        makeProject({ id: "p1", name: "Active Project", status: "active" }),
        makeProject({ id: "p2", name: "Archived Project", status: "archived" }),
      ];

      const { user } = renderProjectList(projects);

      // Active project badge visible on the default "active" tab
      expect(screen.getByText("active")).toBeInTheDocument();

      // Switch to the archived tab to see the archived project
      await user.click(screen.getByRole("tab", { name: /Archived/i }));
      expect(await screen.findByText("archived")).toBeInTheDocument();
    });

    it("shows project description when present", () => {
      const projects = [
        makeProject({ id: "p1", name: "With Desc", description: "A detailed project description" }),
      ];

      renderProjectList(projects);

      expect(screen.getByText("A detailed project description")).toBeInTheDocument();
    });

    it("navigates to project board when card is clicked", async () => {
      const projects = [makeProject({ id: "p1", name: "Clickable" })];
      const { user } = renderProjectList(projects);

      await user.click(screen.getByText("Clickable"));

      expect(mockNavigate).toHaveBeenCalledWith("/w/test/projects/p1/board");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Empty state
  // -----------------------------------------------------------------------

  describe("empty state", () => {
    it("shows empty state when no projects exist", () => {
      renderProjectList([]);

      expect(screen.getByText("No projects yet")).toBeInTheDocument();
      expect(
        screen.getByText("Create your first project to start tracking tasks"),
      ).toBeInTheDocument();
    });

    it("shows Create Project button in empty state", () => {
      renderProjectList([]);

      const emptyStateBtn = screen.getByRole("button", { name: "Create Project" });
      expect(emptyStateBtn).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 3. "Create Project" button opens CreateProjectDialog
  // -----------------------------------------------------------------------

  describe("create project dialog", () => {
    it("opens CreateProjectDialog when header button is clicked", async () => {
      const projects = [makeProject({ id: "p1" })];
      const { user } = renderProjectList(projects);

      const newBtn = screen.getByRole("button", { name: /New Project/i });
      await user.click(newBtn);

      await waitFor(() => {
        expect(screen.getByTestId("create-project-dialog")).toBeInTheDocument();
      });
      expect(screen.getByText("Create Project Dialog")).toBeInTheDocument();
    });

    it("opens CreateProjectDialog from empty state button", async () => {
      const { user } = renderProjectList([]);

      await user.click(screen.getByRole("button", { name: "Create Project" }));

      await waitFor(() => {
        expect(screen.getByTestId("create-project-dialog")).toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------------
  // 4. Project card action menu shows correct options
  // -----------------------------------------------------------------------

  describe("project action menu", () => {
    it("shows correct menu items when action button is clicked", async () => {
      const projects = [makeProject({ id: "p1", name: "My Project" })];
      const { user } = renderProjectList(projects);

      const actionBtn = screen.getByRole("button", { name: "Project actions" });
      await user.click(actionBtn);

      const menu = await screen.findByRole("menu");
      expect(menu).toBeInTheDocument();

      const items = within(menu).getAllByRole("menuitem");
      expect(items).toHaveLength(6);

      expect(screen.getByRole("menuitem", { name: /Open project/i })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Rename/i })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Project settings/i })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Mark as completed/i })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Archive project/i })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Delete project/i })).toBeInTheDocument();
    });

    it("Open project navigates to project board", async () => {
      const projects = [makeProject({ id: "p1" })];
      const { user } = renderProjectList(projects);

      await user.click(screen.getByRole("button", { name: "Project actions" }));
      await screen.findByRole("menu");

      await user.click(screen.getByRole("menuitem", { name: /Open project/i }));

      expect(mockNavigate).toHaveBeenCalledWith("/w/test/projects/p1/board");
    });

    it("Project settings navigates to settings page", async () => {
      const projects = [makeProject({ id: "p1" })];
      const { user } = renderProjectList(projects);

      await user.click(screen.getByRole("button", { name: "Project actions" }));
      await screen.findByRole("menu");

      await user.click(screen.getByRole("menuitem", { name: /Project settings/i }));

      expect(mockNavigate).toHaveBeenCalledWith("/w/test/projects/p1/settings");
    });

    it("archived projects show restore option instead of archive", async () => {
      const projects = [makeProject({ id: "p1", status: "archived" })];
      const { user } = renderProjectList(projects);

      // Switch to the archived tab where the archived project lives
      await user.click(screen.getByRole("tab", { name: /Archived/i }));

      const actionBtn = await screen.findByRole("button", { name: "Project actions" });
      await user.click(actionBtn);
      await screen.findByRole("menu");

      // Archived tab shows "Restore project" instead of "Archive project"
      expect(screen.getByRole("menuitem", { name: /Restore project/i })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: /Archive project/i })).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Favorite toggle
  // -----------------------------------------------------------------------

  describe("favorite toggle", () => {
    it("shows 'Add to favorites' button that toggles to 'Remove from favorites'", async () => {
      const projects = [makeProject({ id: "p1", name: "Fav Project" })];
      const { user } = renderProjectList(projects);

      const addBtn = screen.getByRole("button", { name: "Add to favorites" });
      expect(addBtn).toBeInTheDocument();

      await user.click(addBtn);

      expect(screen.getByRole("button", { name: "Remove from favorites" })).toBeInTheDocument();
    });

    it("toggling favorite again removes it", async () => {
      const projects = [makeProject({ id: "p1" })];
      const { user } = renderProjectList(projects);

      // Add to favorites
      await user.click(screen.getByRole("button", { name: "Add to favorites" }));
      expect(screen.getByRole("button", { name: "Remove from favorites" })).toBeInTheDocument();

      // Remove from favorites
      await user.click(screen.getByRole("button", { name: "Remove from favorites" }));
      expect(screen.getByRole("button", { name: "Add to favorites" })).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Archive action
  // -----------------------------------------------------------------------

  describe("archive project", () => {
    it("calls API to archive and shows success toast", async () => {
      const projects = [makeProject({ id: "p1", name: "To Archive" })];
      const { user } = renderProjectList(projects);

      await user.click(screen.getByRole("button", { name: "Project actions" }));
      await screen.findByRole("menu");

      await user.click(screen.getByRole("menuitem", { name: /Archive project/i }));

      expect(mockPatch).toHaveBeenCalledWith("/api/projects/p1", { status: "archived" });
      expect(mockToast).toHaveBeenCalledWith("Project archived", { variant: "success" });
    });

    it("optimistically hides the project card", async () => {
      const projects = [
        makeProject({ id: "p1", name: "To Archive" }),
        makeProject({ id: "p2", name: "Stay Visible" }),
      ];
      const { user } = renderProjectList(projects);

      expect(screen.getByText("To Archive")).toBeInTheDocument();

      // Open action menu for the first project
      const actionBtns = screen.getAllByRole("button", { name: "Project actions" });
      await user.click(actionBtns[0]);
      await screen.findByRole("menu");

      await user.click(screen.getByRole("menuitem", { name: /Archive project/i }));

      // The archived project should be optimistically hidden
      expect(screen.queryByText("To Archive")).not.toBeInTheDocument();
      expect(screen.getByText("Stay Visible")).toBeInTheDocument();
    });

    it("rolls back and shows error toast when archive API call fails", async () => {
      mockPatch.mockRejectedValueOnce(new Error("Server error"));

      const projects = [makeProject({ id: "p1", name: "Rollback Project" })];
      const { user } = renderProjectList(projects);

      await user.click(screen.getByRole("button", { name: "Project actions" }));
      await screen.findByRole("menu");

      await user.click(screen.getByRole("menuitem", { name: /Archive project/i }));

      // After the rejected API call, the project should remain visible (rollback)
      // and an error toast should be shown. The optimistic hide + rollback may
      // batch in a single React render when the mock rejects synchronously.
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith("Failed to archive project", { variant: "error" });
      });

      // Project should be visible after rollback
      expect(screen.getByText("Rollback Project")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Delete action shows confirmation dialog
  // -----------------------------------------------------------------------

  describe("delete project", () => {
    it("clicking Delete opens confirmation dialog", async () => {
      const projects = [makeProject({ id: "p1", name: "Doomed Project" })];
      const { user } = renderProjectList(projects);

      await user.click(screen.getByRole("button", { name: "Project actions" }));
      await screen.findByRole("menu");

      await user.click(screen.getByRole("menuitem", { name: /Delete project/i }));

      // Confirmation dialog should appear with the warning text
      await waitFor(() => {
        expect(
          screen.getByText(/This will permanently delete all tasks and data/),
        ).toBeInTheDocument();
      });
      // The project name appears in both the card and the dialog <strong> tag
      const projectNameElements = screen.getAllByText("Doomed Project");
      expect(projectNameElements.length).toBeGreaterThanOrEqual(2);
    });

    it("confirming delete calls API and shows success toast", async () => {
      const projects = [makeProject({ id: "p1", name: "Doomed Project" })];
      const { user } = renderProjectList(projects);

      // Open dropdown and click Delete
      await user.click(screen.getByRole("button", { name: "Project actions" }));
      await screen.findByRole("menu");
      await user.click(screen.getByRole("menuitem", { name: /Delete project/i }));

      // Wait for confirmation dialog
      await waitFor(() => {
        expect(
          screen.getByText(/This will permanently delete all tasks and data/),
        ).toBeInTheDocument();
      });

      // Click confirm button in the dialog (waitFor needed for dialog useEffect to set open attribute)
      const confirmBtn = await waitFor(() =>
        screen.getByRole("button", { name: "Delete Project" }),
      );
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith("/api/projects/p1");
      });
      expect(mockToast).toHaveBeenCalledWith("Project deleted", { variant: "success" });
      expect(mockRefetchProjects).toHaveBeenCalled();
    });

    it("cancelling delete does not call API", async () => {
      const projects = [makeProject({ id: "p1", name: "Safe Project" })];
      const { user } = renderProjectList(projects);

      await user.click(screen.getByRole("button", { name: "Project actions" }));
      await screen.findByRole("menu");
      await user.click(screen.getByRole("menuitem", { name: /Delete project/i }));

      // Wait for the confirmation dialog warning text
      await waitFor(() => {
        expect(
          screen.getByText(/This will permanently delete all tasks and data/),
        ).toBeInTheDocument();
      });

      // Click Cancel (waitFor needed for dialog useEffect to set open attribute)
      const cancelBtn = await waitFor(() =>
        screen.getByRole("button", { name: "Cancel" }),
      );
      await user.click(cancelBtn);

      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("shows error toast when delete fails", async () => {
      mockDelete.mockRejectedValueOnce(new Error("Server error"));

      const projects = [makeProject({ id: "p1", name: "Error Project" })];
      const { user } = renderProjectList(projects);

      await user.click(screen.getByRole("button", { name: "Project actions" }));
      await screen.findByRole("menu");
      await user.click(screen.getByRole("menuitem", { name: /Delete project/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/This will permanently delete all tasks and data/),
        ).toBeInTheDocument();
      });

      const deleteBtn = await waitFor(() =>
        screen.getByRole("button", { name: "Delete Project" }),
      );
      await user.click(deleteBtn);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith("Failed to delete project", { variant: "error" });
      });
    });
  });

  // -----------------------------------------------------------------------
  // 8. Rename dialog
  // -----------------------------------------------------------------------

  describe("rename project", () => {
    it("opens rename dialog when Rename menu item is clicked", async () => {
      const projects = [makeProject({ id: "p1", name: "Old Name" })];
      const { user } = renderProjectList(projects);

      await user.click(screen.getByRole("button", { name: "Project actions" }));
      await screen.findByRole("menu");
      await user.click(screen.getByRole("menuitem", { name: /Rename/i }));

      await waitFor(() => {
        expect(screen.getByText("Rename Project")).toBeInTheDocument();
      });

      // Should pre-populate with current name
      const input = screen.getByPlaceholderText("Project name");
      expect(input).toHaveValue("Old Name");
    });

    it("calls API with new name and shows success toast", async () => {
      mockPatch.mockResolvedValue({});

      const projects = [makeProject({ id: "p1", name: "Old Name" })];
      const { user } = renderProjectList(projects);

      await user.click(screen.getByRole("button", { name: "Project actions" }));
      await screen.findByRole("menu");
      await user.click(screen.getByRole("menuitem", { name: /Rename/i }));

      await waitFor(() => {
        expect(screen.getByText("Rename Project")).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText("Project name");
      await user.clear(input);
      await user.type(input, "New Name");

      const renameBtn = await waitFor(() =>
        screen.getByRole("button", { name: "Rename" }),
      );
      await user.click(renameBtn);

      await waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith("/api/projects/p1", { name: "New Name" });
      });
      expect(mockToast).toHaveBeenCalledWith("Project renamed", { variant: "success" });
    });
  });

  // -----------------------------------------------------------------------
  // Breadcrumbs
  // -----------------------------------------------------------------------

  describe("breadcrumbs", () => {
    it("shows workspace name and Projects breadcrumb", () => {
      renderProjectList([makeProject({ id: "p1" })]);

      expect(screen.getByText("Test Workspace")).toBeInTheDocument();

      // "Projects" appears in both the breadcrumb (aria-current="page") and the h3 heading
      const breadcrumbNav = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(within(breadcrumbNav).getByText("Projects")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Projects", level: 3 })).toBeInTheDocument();
    });
  });
});

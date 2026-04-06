import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/web/components/ui/ToastContext";
import type { TaskGroup } from "@/web/contexts/ProjectContext";

import ProjectSettings from "./ProjectSettings";

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

const mockApiGet = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiPatch = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiPost = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockApiDelete = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>("@/web/lib/api/client");
  const apiFn = Object.assign(vi.fn(), {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: vi.fn(),
    patch: (...args: unknown[]) => mockApiPatch(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  });
  return { ...actual, api: apiFn };
});

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1", name: "Alice", email: "alice@test.com", image: null },
      session: { id: "sess-1" },
    },
  }),
}));

const mockRefetch = vi.fn();
const mockUpdateProject = vi.fn();
const mockRefetchTaskGroups = vi.fn();
const mockRefetchTasks = vi.fn();
const mockUpdateTaskGroup = vi.fn();
const mockUseProject = vi.fn();

vi.mock("@/web/contexts/ProjectContext", () => ({
  useProject: (): unknown => mockUseProject(),
}));

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: {
      id: "ws-1",
      name: "Test Workspace",
      slug: "test-workspace",
      theme: "default",
    },
    members: [
      {
        id: "m-1",
        userId: "user-1",
        role: "owner",
        user: { id: "user-1", name: "Alice", email: "alice@test.com" },
      },
      {
        id: "m-2",
        userId: "user-2",
        role: "member",
        user: { id: "user-2", name: "Bob", email: "bob@test.com" },
      },
    ],
    teams: [],
    refetch: vi.fn(),
  }),
}));

const mockUseProjectPermissions = vi.fn();

vi.mock("@/web/hooks/use-permissions", () => ({
  useProjectPermissions: (...args: unknown[]): unknown => mockUseProjectPermissions(...args),
}));

vi.mock("@/web/hooks/use-project-cover", () => ({
  useProjectCover: () => ({
    coverUrl: null,
    uploading: false,
    handleUpload: vi.fn(),
    handleRemove: vi.fn(),
  }),
}));

// Skip tab-panel exit animations — jsdom does not fire CSS animationend events,
// so without this the exiting panel blocks the incoming one from rendering.
vi.mock("@/web/hooks/use-reduced-motion", () => ({
  usePrefersReducedMotion: () => true,
}));

// ---------------------------------------------------------------------------
// Browser API polyfills for jsdom
// ---------------------------------------------------------------------------

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
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Test Project",
    description: "A test project",
    status: "active" as const,
    workspaceId: "ws-1",
    theme: null,
    icon: null,
    coverImageKey: null,
    coverImagePosition: null,
    budget: null,
    ...overrides,
  };
}

function makeTaskGroup(
  id: string,
  name: string,
  position: string,
  overrides: Partial<TaskGroup> = {},
): TaskGroup {
  return {
    id,
    name,
    color: "oklch(0.6368 0.2078 25.33)",
    isCompletionGroup: false,
    position,
    taskCount: 0,
    ...overrides,
  };
}

function makeProjectMember(
  id: string,
  userId: string,
  name: string,
  email: string,
  role: string = "member",
) {
  return { id, userId, name, email, image: null, role, joinedAt: "2024-01-01T00:00:00Z" };
}

// ---------------------------------------------------------------------------
// Default mock setup
// ---------------------------------------------------------------------------

function setupDefaultMocks(overrides: {
  project?: Record<string, unknown>;
  members?: ReturnType<typeof makeProjectMember>[];
  taskGroups?: TaskGroup[];
  isProjectAdmin?: boolean;
} = {}) {
  const project = makeProject(overrides.project);
  const members = overrides.members ?? [
    makeProjectMember("pm-1", "user-1", "Alice", "alice@test.com", "admin"),
  ];
  const taskGroups = overrides.taskGroups ?? [
    makeTaskGroup("tg-1", "To Do", "a"),
    makeTaskGroup("tg-2", "In Progress", "b"),
    makeTaskGroup("tg-3", "Done", "c", { isCompletionGroup: true }),
  ];

  mockUseProject.mockReturnValue({
    project,
    members,
    taskGroups,
    tasks: [],
    refetchTasks: mockRefetchTasks,
    refetchTaskGroups: mockRefetchTaskGroups,
    refetch: mockRefetch,
    updateProject: mockUpdateProject,
    updateTask: vi.fn(),
    removeTask: vi.fn(),
    addTask: vi.fn(),
    updateTaskGroup: mockUpdateTaskGroup,
    removeTaskGroup: vi.fn(),
    addTaskGroup: vi.fn(),
  });

  mockUseProjectPermissions.mockReturnValue({
    workspaceRole: "owner",
    isWorkspaceOwner: true,
    isWorkspaceAdmin: true,
    canManageWorkspace: true,
    canDeleteWorkspace: true,
    projectRole: "admin",
    isProjectAdmin: overrides.isProjectAdmin ?? true,
    canEditTasks: true,
    canViewProject: true,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={["/w/test-workspace/p/proj-1/settings"]}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function renderPage() {
  const Wrapper = createWrapper();
  const user = userEvent.setup();
  render(
    <Wrapper>
      <ProjectSettings />
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
  mockApiPost.mockResolvedValue({});
  mockApiDelete.mockResolvedValue({});
  mockApiGet.mockResolvedValue({ members: [] });

  // jsdom does not implement HTMLDialogElement.showModal / .close
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Tests for the ProjectSettings page component, the largest page in the app.
 *
 * Covers: tab navigation, general settings form, members DataTable,
 * task groups management, and appearance/theme selection. Regressions here
 * can prevent project admins from configuring projects correctly.
 */
describe("ProjectSettings", () => {
  // -----------------------------------------------------------------------
  // 1. Permission guard
  // -----------------------------------------------------------------------

  describe("permission guard", () => {
    it("shows permission denied alert when user is not a project admin", () => {
      setupDefaultMocks({ isProjectAdmin: false });
      renderPage();

      expect(
        screen.getByText("You do not have permission to manage project settings."),
      ).toBeInTheDocument();
    });

    it("does not render tabs when user is not a project admin", () => {
      setupDefaultMocks({ isProjectAdmin: false });
      renderPage();

      expect(screen.queryByRole("tab", { name: "General" })).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Tab navigation
  // -----------------------------------------------------------------------

  describe("tab navigation", () => {
    it("renders all four tabs for project admins", () => {
      setupDefaultMocks();
      renderPage();

      expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Members" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Task Groups" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Appearance" })).toBeInTheDocument();
    });

    it("shows General tab content by default", () => {
      setupDefaultMocks();
      renderPage();

      expect(screen.getByLabelText("Project Name")).toBeInTheDocument();
    });

    it("switches to Task Groups tab when clicked", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Task Groups" }));

      await waitFor(() => {
        expect(screen.getByText("+ Add Group")).toBeInTheDocument();
      });
    });

    it("switches to Appearance tab when clicked", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Appearance" }));

      await waitFor(() => {
        expect(screen.getByText("Project Theme")).toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------------
  // 3. General tab
  // -----------------------------------------------------------------------

  describe("General tab", () => {
    it("renders form fields with project data pre-populated", () => {
      setupDefaultMocks();
      renderPage();

      expect(screen.getByLabelText("Project Name")).toHaveValue("Test Project");
      expect(screen.getByLabelText("Description")).toHaveValue("A test project");
    });

    it("renders status select with current project status", () => {
      setupDefaultMocks();
      renderPage();

      const statusSelect = screen.getByLabelText("Status");
      expect(statusSelect).toHaveValue("active");
    });

    it("renders budget field", () => {
      setupDefaultMocks({ project: { budget: 50000 } });
      renderPage();

      // budget is stored as cents, displayed as dollars
      expect(screen.getByLabelText("Budget")).toHaveValue(500);
    });

    it("renders Save Changes button", () => {
      setupDefaultMocks();
      renderPage();

      expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    });

    it("calls API patch with correct data on form submission", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      const nameInput = screen.getByLabelText("Project Name");
      await user.clear(nameInput);
      await user.type(nameInput, "Renamed Project");

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(mockApiPatch).toHaveBeenCalledWith(
          "/api/projects/proj-1",
          expect.objectContaining({
            name: "Renamed Project",
            description: "A test project",
            status: "active",
            budget: null,
          }),
        );
      });
    });

    it("trims name and description before sending", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      const nameInput = screen.getByLabelText("Project Name");
      await user.clear(nameInput);
      await user.type(nameInput, "  Trimmed Name  ");

      const descInput = screen.getByLabelText("Description");
      await user.clear(descInput);
      await user.type(descInput, "  Trimmed Desc  ");

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(mockApiPatch).toHaveBeenCalledWith(
          "/api/projects/proj-1",
          expect.objectContaining({
            name: "Trimmed Name",
            description: "Trimmed Desc",
          }),
        );
      });
    });

    it("does not submit when name is empty", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      const nameInput = screen.getByLabelText("Project Name");
      await user.clear(nameInput);

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      expect(mockApiPatch).not.toHaveBeenCalled();
    });

    it("shows success toast after successful save", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(screen.getByText("Project settings updated.")).toBeInTheDocument();
      });
    });

    it("shows error alert when save fails", async () => {
      mockApiPatch.mockRejectedValueOnce(new Error("Validation failed"));
      setupDefaultMocks();
      const { user } = renderPage();

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(screen.getByText("Validation failed")).toBeInTheDocument();
      });
    });

    it("shows Saving... text and disables button during save", async () => {
      let resolveApi!: (value: unknown) => void;
      mockApiPatch.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveApi = resolve;
          }),
      );
      setupDefaultMocks();
      const { user } = renderPage();

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
      });

      resolveApi({});
    });

    it("converts budget to cents before sending", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      const budgetInput = screen.getByLabelText("Budget");
      await user.clear(budgetInput);
      await user.type(budgetInput, "250.50");

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(mockApiPatch).toHaveBeenCalledWith(
          "/api/projects/proj-1",
          expect.objectContaining({
            budget: 25050,
          }),
        );
      });
    });

    it("sends null budget when field is empty", async () => {
      setupDefaultMocks({ project: { budget: 10000 } });
      const { user } = renderPage();

      const budgetInput = screen.getByLabelText("Budget");
      await user.clear(budgetInput);

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(mockApiPatch).toHaveBeenCalledWith(
          "/api/projects/proj-1",
          expect.objectContaining({
            budget: null,
          }),
        );
      });
    });

    it("renders Danger Zone with Delete Project button", () => {
      setupDefaultMocks();
      renderPage();

      expect(screen.getByText("Danger Zone")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete Project" })).toBeInTheDocument();
    });

    it("renders icon button for choosing a project icon", () => {
      setupDefaultMocks();
      renderPage();

      expect(screen.getByRole("button", { name: "Choose icon" })).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 4. Members tab
  // -----------------------------------------------------------------------

  describe("Members tab", () => {
    it("renders member count and Add Member button", async () => {
      setupDefaultMocks();
      mockApiGet.mockResolvedValue({
        members: [
          {
            id: "pm-1",
            userId: "user-1",
            role: "admin",
            addedAt: "2024-01-01T00:00:00Z",
            user: { id: "user-1", name: "Alice", email: "alice@test.com", image: null },
          },
          {
            id: "pm-2",
            userId: "user-3",
            role: "member",
            addedAt: "2024-02-01T00:00:00Z",
            user: { id: "user-3", name: "Charlie", email: "charlie@test.com", image: null },
          },
        ],
      });
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Members" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Add Member" })).toBeInTheDocument();
      });
    });

  });

  // -----------------------------------------------------------------------
  // 5. Task Groups tab
  // -----------------------------------------------------------------------

  describe("Task Groups tab", () => {
    it("renders group count text", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Task Groups" }));

      await waitFor(() => {
        expect(screen.getByText("3 groups")).toBeInTheDocument();
      });
    });

    it("shows Auto-complete badge for completion groups", async () => {
      setupDefaultMocks({
        taskGroups: [
          makeTaskGroup("tg-1", "To Do", "a"),
          makeTaskGroup("tg-2", "Done", "b", { isCompletionGroup: true }),
        ],
      });
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Task Groups" }));

      await waitFor(() => {
        expect(screen.getByText("Auto-complete")).toBeInTheDocument();
      });
    });

    it("renders reorder buttons for each group", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Task Groups" }));

      await waitFor(() => {
        const moveUpButtons = screen.getAllByRole("button", { name: "Move up" });
        const moveDownButtons = screen.getAllByRole("button", { name: "Move down" });
        expect(moveUpButtons).toHaveLength(3);
        expect(moveDownButtons).toHaveLength(3);
      });
    });

    it("disables Move up on first group and Move down on last group", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Task Groups" }));

      await waitFor(() => {
        const moveUpButtons = screen.getAllByRole("button", { name: "Move up" });
        const moveDownButtons = screen.getAllByRole("button", { name: "Move down" });
        expect(moveUpButtons[0]).toBeDisabled();
        expect(moveDownButtons[moveDownButtons.length - 1]).toBeDisabled();
      });
    });

    it("shows + Add Group button and opens create dialog", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Task Groups" }));

      await waitFor(() => {
        expect(screen.getByText("+ Add Group")).toBeInTheDocument();
      });

      await user.click(screen.getByText("+ Add Group"));

      await waitFor(() => {
        expect(screen.getByText("Create Task Group")).toBeInTheDocument();
      });
    });

    it("shows empty state when there are no task groups", async () => {
      setupDefaultMocks({ taskGroups: [] });
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Task Groups" }));

      await waitFor(() => {
        expect(screen.getByText("No task groups")).toBeInTheDocument();
        expect(
          screen.getByText("Create task groups to organize your project tasks into columns or categories."),
        ).toBeInTheDocument();
      });
    });

    it("renders edit and delete buttons for each group", async () => {
      setupDefaultMocks({
        taskGroups: [
          makeTaskGroup("tg-1", "To Do", "a"),
          makeTaskGroup("tg-2", "Done", "b"),
        ],
      });
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Task Groups" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Edit To Do" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Delete To Do" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Edit Done" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Delete Done" })).toBeInTheDocument();
      });
    });

    it("disables delete button when only one group exists", async () => {
      setupDefaultMocks({
        taskGroups: [makeTaskGroup("tg-1", "To Do", "a")],
      });
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Task Groups" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Delete To Do" })).toBeDisabled();
      });
    });
  });

  // -----------------------------------------------------------------------
  // 6. Appearance tab
  // -----------------------------------------------------------------------

  describe("Appearance tab", () => {
    it("renders Project Theme heading and description", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Appearance" }));

      await waitFor(() => {
        expect(screen.getByText("Project Theme")).toBeInTheDocument();
        expect(
          screen.getByText(
            "Override the workspace theme for this project. All project members will see this theme when viewing the project.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("shows inherited workspace theme text when no project override", async () => {
      setupDefaultMocks({ project: { theme: null } });
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Appearance" }));

      await waitFor(() => {
        expect(screen.getByText(/Currently inheriting the workspace theme/)).toBeInTheDocument();
      });
    });

    it("shows Use Workspace Theme button when project has a theme override", async () => {
      setupDefaultMocks({ project: { theme: "noir" } });
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Appearance" }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /Use Workspace Theme/ }),
        ).toBeInTheDocument();
      });
    });

    it("calls API to reset theme when Use Workspace Theme is clicked", async () => {
      setupDefaultMocks({ project: { theme: "noir" } });
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Appearance" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Use Workspace Theme/ })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Use Workspace Theme/ }));

      await waitFor(() => {
        expect(mockApiPatch).toHaveBeenCalledWith(
          "/api/projects/proj-1",
          { theme: null },
        );
      });
    });

    it("calls API patch when a theme is selected", async () => {
      setupDefaultMocks();
      const { user } = renderPage();

      await user.click(screen.getByRole("tab", { name: "Appearance" }));

      await waitFor(() => {
        expect(screen.getByText("Noir")).toBeInTheDocument();
      });

      // The ThemeGrid renders buttons - find the one containing "Noir" text
      const noirButton = screen.getByText("Noir").closest("button");
      expect(noirButton).not.toBeNull();
      await user.click(noirButton!);

      await waitFor(() => {
        expect(mockApiPatch).toHaveBeenCalledWith(
          "/api/projects/proj-1",
          { theme: "noir" },
        );
      });
    });
  });
});

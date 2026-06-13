/**
 * Tests for ProjectLayout's calendar export/import menu.
 *
 * Why these matter: the menu's gating IS the feature's permission and
 * placement contract — it must vanish on the settings/dashboard tabs (same
 * gate as TaskFilterBar: both act on tasks, which those tabs don't show),
 * and the import entry + dialog must be unreachable for viewers because the
 * import endpoint requires edit rights (the UI hiding mirrors, not replaces,
 * the backend check). The export test pins that the CLIENT-side path is used
 * (`downloadProjectICS` with ALL project tasks — no endpoint, no filtered
 * subset) and that a date-less project explains itself via toast instead of
 * downloading an empty calendar.
 *
 * Heavy, unrelated collaborators (TaskFilterBar, TaskDetailPanel, contexts,
 * cover/permissions/recents hooks) are mocked; the dropdown, tabs, and the
 * real ImportIcsDialog render for real so the menu → dialog wiring is
 * exercised end to end.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { ProjectPermissions } from "@/web/hooks/use-permissions";

// ---------------------------------------------------------------------------
// Mocks — declared before the dynamic import of the component under test
// ---------------------------------------------------------------------------

const mockToast = vi.fn();

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), dismissAll: vi.fn() }),
}));

const mockTasks = [
  {
    id: "t-1",
    title: "Dated task",
    taskGroupId: "g-todo",
    priority: "none",
    completed: false,
    dueDate: "2026-03-10T00:00:00.000Z",
    position: "a0",
  },
];

vi.mock("@/web/contexts/ProjectContext", () => ({
  ProjectProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useProject: () => ({
    project: { id: "proj-1", name: "Test Project", status: "active", workspaceId: "ws-1" },
    members: [],
    taskGroups: [
      { id: "g-todo", name: "To Do", isCompletionGroup: false, position: "a0" },
    ],
    tasks: mockTasks,
    tasksError: null,
    taskGroupsError: null,
    refetchTasks: vi.fn(),
    refetchTaskGroups: vi.fn(),
    refetch: vi.fn(),
    updateProject: vi.fn(),
    updateTask: vi.fn(),
    removeTask: vi.fn(),
    addTask: vi.fn(),
    updateTaskGroup: vi.fn(),
    removeTaskGroup: vi.fn(),
    addTaskGroup: vi.fn(),
  }),
}));

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws-1", name: "Test Workspace", slug: "test", theme: null },
    members: [],
    projects: [],
    refetchProjects: vi.fn(),
    refetch: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock("@/web/contexts/ThemeControlContext", () => ({
  useSetThemeOverride: () => vi.fn(),
}));

/** Per-test permission control: viewer vs member/admin. */
let mockPermissions: Pick<ProjectPermissions, "isProjectAdmin" | "canEditTasks">;

vi.mock("@/web/hooks/use-permissions", () => ({
  useProjectPermissions: () => mockPermissions,
  useWorkspacePermissions: () => ({
    workspaceRole: "member",
    isWorkspaceOwner: false,
    isWorkspaceAdmin: false,
    canManageWorkspace: false,
    canDeleteWorkspace: false,
  }),
}));

vi.mock("@/web/hooks/use-project-cover", () => ({
  useProjectCover: () => ({
    coverUrl: null,
    coverSrcSet: undefined,
    coverAttribution: null,
    uploading: false,
    handleUpload: vi.fn(),
    handleRemove: vi.fn(),
    handleApplyUnsplash: vi.fn(),
  }),
}));

vi.mock("@/web/hooks/use-recents", () => ({
  useRecents: () => ({ addRecent: vi.fn(), recents: [] }),
}));

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u-1" } } }),
}));

vi.mock("@/web/lib/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: Object.assign(vi.fn(), {
    get: vi.fn(() => Promise.resolve({ members: [] })),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock("@/web/lib/export-ics", () => ({
  downloadProjectICS: vi.fn(() => 1),
}));

vi.mock("@/web/components/project/TaskFilterBar", () => ({
  TaskFilterBar: () => <div data-testid="task-filter-bar" />,
}));

vi.mock("@/web/pages/TaskDetail/TaskDetailPanel", () => ({
  TaskDetailPanel: () => null,
}));

import { downloadProjectICS } from "@/web/lib/export-ics";

const mockDownload = downloadProjectICS as Mock<typeof downloadProjectICS>;

// ---------------------------------------------------------------------------
// jsdom polyfill: HTMLDialogElement (the real ImportIcsDialog renders one)
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
// Dynamic import so mocks are established first
// ---------------------------------------------------------------------------

const { ProjectLayout } = await import("./ProjectLayout");

// ---------------------------------------------------------------------------
// Render harness
// ---------------------------------------------------------------------------

function renderLayout(tab: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/w/test/projects/proj-1/${tab}`]}>
        <Routes>
          <Route path="/w/:slug/projects/:projectId/*" element={<ProjectLayout />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const MENU_TRIGGER = { name: "Calendar export and import" };

beforeEach(() => {
  vi.clearAllMocks();
  mockDownload.mockReturnValue(1);
  mockPermissions = { isProjectAdmin: true, canEditTasks: true };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectLayout calendar menu", () => {
  it("shows export and import items on the board tab for members with edit rights", async () => {
    const user = userEvent.setup();
    renderLayout("board");

    await user.click(screen.getByRole("button", MENU_TRIGGER));

    expect(
      await screen.findByRole("menuitem", { name: "Export calendar (.ics)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Import calendar (.ics)…" }),
    ).toBeInTheDocument();
  });

  it.each(["list", "timeline", "calendar"])("renders the menu on the %s tab", (tab) => {
    renderLayout(tab);
    expect(screen.getByRole("button", MENU_TRIGGER)).toBeInTheDocument();
  });

  it.each(["settings", "dashboard"])(
    "hides the menu on the %s tab (same gate as TaskFilterBar)",
    (tab) => {
      renderLayout(tab);
      expect(screen.queryByRole("button", MENU_TRIGGER)).not.toBeInTheDocument();
      expect(screen.queryByTestId("task-filter-bar")).not.toBeInTheDocument();
    },
  );

  it("hides the import item AND the dialog for viewers, but keeps export", async () => {
    mockPermissions = { isProjectAdmin: false, canEditTasks: false };
    const user = userEvent.setup();
    renderLayout("board");

    await user.click(screen.getByRole("button", MENU_TRIGGER));

    expect(
      await screen.findByRole("menuitem", { name: "Export calendar (.ics)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Import calendar (.ics)…" }),
    ).not.toBeInTheDocument();
    // The dialog isn't even mounted for viewers.
    expect(screen.queryByText("Import calendar")).not.toBeInTheDocument();
  });

  it("export item triggers the client-side download with the project name and ALL tasks", async () => {
    const user = userEvent.setup();
    renderLayout("board");

    await user.click(screen.getByRole("button", MENU_TRIGGER));
    await user.click(
      await screen.findByRole("menuitem", { name: "Export calendar (.ics)" }),
    );

    expect(mockDownload).toHaveBeenCalledWith("Test Project", mockTasks);
    // A download happened (count 1) → no toast needed.
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("explains via toast when there is nothing to export instead of downloading an empty file", async () => {
    mockDownload.mockReturnValue(0);
    const user = userEvent.setup();
    renderLayout("board");

    await user.click(screen.getByRole("button", MENU_TRIGGER));
    await user.click(
      await screen.findByRole("menuitem", { name: "Export calendar (.ics)" }),
    );

    expect(mockToast).toHaveBeenCalledWith(
      "This project has no tasks with dates to export.",
      { variant: "info" },
    );
  });

  it("import item opens the real ImportIcsDialog", async () => {
    const user = userEvent.setup();
    renderLayout("board");

    await user.click(screen.getByRole("button", MENU_TRIGGER));
    await user.click(
      await screen.findByRole("menuitem", { name: "Import calendar (.ics)…" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText("Import calendar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload file" })).toBeInTheDocument();
  });
});

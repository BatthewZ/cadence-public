/**
 * Component tests for the Workspace Settings → Data tab.
 *
 * Why these matter: this page is the ONLY UI wiring of the workspace
 * export/import contracts, and two of its behaviors are invisible-failure
 * traps if they drift:
 *
 * 1. The dry-run endpoint is STATELESS — confirming must re-POST the exact
 *    same `File` object that produced the preview. If a refactor drops the
 *    held File (e.g. by moving the preview into the query cache), the
 *    confirm button would silently import nothing or a different file. The
 *    confirm test pins object identity (`toBe`) across both POSTs.
 * 2. The export download is a plain anchor whose href carries the
 *    `includeActivity` opt-in — a broken href downloads a silently
 *    incomplete archive, the exact "data held hostage" failure the feature
 *    exists to prevent.
 *
 * The API client is mocked (WX7's endpoint is a separate unit); fixtures
 * are typed by the shared `ImportPreview` / `ImportResult` schemas so the
 * test inputs cannot drift from the real contract.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { MAX_IMPORT_FILE_BYTES } from "@/shared/schemas/workspace-export";
import type { ImportPreview, ImportResult } from "@/shared/schemas/workspace-import";

// ---------------------------------------------------------------------------
// Mocks — declared before the dynamic import of the component under test
// ---------------------------------------------------------------------------

vi.mock("@/web/lib/api/client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    ApiError,
    api: Object.assign(vi.fn(), {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

import { api, ApiError } from "@/web/lib/api/client";

const mockPost = api.post as Mock<(path: string, body: unknown) => Promise<unknown>>;

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: {
      id: "ws-1",
      name: "Test Workspace",
      slug: "test-workspace",
      description: "A test workspace",
      theme: "default",
    },
    members: [],
    projects: [],
    teams: [],
    refetch: vi.fn(),
    refetchProjects: vi.fn(),
    loading: false,
    error: null,
  }),
}));

/** Flipped per-test to exercise the non-admin read-only state. */
let mockCanManage = true;

vi.mock("@/web/hooks/use-permissions", () => ({
  useWorkspacePermissions: () => ({
    workspaceRole: mockCanManage ? "owner" : "member",
    isWorkspaceOwner: mockCanManage,
    isWorkspaceAdmin: mockCanManage,
    canManageWorkspace: mockCanManage,
    canDeleteWorkspace: mockCanManage,
  }),
}));

// ---------------------------------------------------------------------------
// Dynamic import so mocks are established first
// ---------------------------------------------------------------------------

const { default: WorkspaceData } = await import("./WorkspaceData");

// ---------------------------------------------------------------------------
// Fixtures — typed by the shared contracts so they cannot drift from WX7
// ---------------------------------------------------------------------------

const previewFixture: ImportPreview = {
  dryRun: true,
  sourceFormat: "trello",
  counts: { projects: 2, taskGroups: 5, tasks: 42, labels: 6, subtasks: 10, comments: 3 },
  unmatchedUsers: [{ email: "ghost@example.com", name: "Ghost User", taskCount: 7 }],
  // webhooks/teams/invitations deliberately zero: the preview must render
  // ONLY non-zero skipped rows.
  skipped: { webhooks: 0, teams: 0, invitations: 0, attachments: 4, activity: 0, closedItems: 9 },
  warnings: ["2 recurrence parents were not found in the file and were cleared."],
};

const resultFixture: ImportResult = {
  dryRun: false,
  sourceFormat: "trello",
  counts: { projects: 1, taskGroups: 3, tasks: 20, labels: 6, subtasks: 5, comments: 3 },
  unmatchedUsers: [{ email: "ghost@example.com", name: "Ghost User", taskCount: 7 }],
  skipped: { webhooks: 0, teams: 0, invitations: 0, attachments: 4, activity: 0, closedItems: 9 },
  warnings: [],
  failedProjects: [{ name: "Roadmap", error: "UNIQUE constraint failed: task_group.position" }],
};

function jsonFile(name = "export.json", content = "{}"): File {
  return new File([content], name, { type: "application/json" });
}

/** A File whose reported size exceeds the import cap without allocating
 *  20 MB in the test process. */
function oversizeFile(): File {
  const file = jsonFile("huge.json");
  Object.defineProperty(file, "size", { value: MAX_IMPORT_FILE_BYTES + 1 });
  return file;
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
      <MemoryRouter initialEntries={["/w/test-workspace/settings/data"]}>
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
      <WorkspaceData />
    </Wrapper>,
  );
  return { user };
}

/**
 * Selects a file through the hidden input with `fireEvent.change` rather
 * than `userEvent.upload`: upload() clicks the input, the click bubbles to
 * FileUpload's wrapper (whose onClick re-clicks the input), and jsdom has no
 * user-activation gate to break that recursion (ImportIcsDialog precedent).
 */
function selectFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
}

/** The bordered-list row (label + count) containing the given label text. */
function rowFor(label: string): HTMLElement {
  const row = screen.getByText(label).closest("li");
  expect(row).not.toBeNull();
  return row!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCanManage = true;
  mockPost.mockResolvedValue(previewFixture);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkspaceData", () => {
  // -------------------------------------------------------------------------
  // 1. Page chrome
  // -------------------------------------------------------------------------

  it("renders the settings chrome with the Data tab active", () => {
    renderPage();

    expect(screen.getByText("Workspace Settings")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Import" })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2. Export card — anchor href + includeActivity toggle
  // -------------------------------------------------------------------------

  it("renders the download link pointing at the export endpoint", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "Download workspace (JSON)" })).toHaveAttribute(
      "href",
      "/api/workspaces/ws-1/export",
    );
  });

  it("toggles includeActivity on the download href via the checkbox", async () => {
    const { user } = renderPage();

    await user.click(screen.getByLabelText("Include activity history"));
    expect(screen.getByRole("link", { name: "Download workspace (JSON)" })).toHaveAttribute(
      "href",
      "/api/workspaces/ws-1/export?includeActivity=true",
    );

    await user.click(screen.getByLabelText("Include activity history"));
    expect(screen.getByRole("link", { name: "Download workspace (JSON)" })).toHaveAttribute(
      "href",
      "/api/workspaces/ws-1/export",
    );
  });

  it("states the honest attachment and CSV-pointer notes", () => {
    renderPage();

    expect(
      screen.getByText(/Attachments are referenced by URL in the export manifest/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Export tasks as CSV from each project/)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 3. Import — upload triggers the dry-run POST and renders the preview
  // -------------------------------------------------------------------------

  it("POSTs the file as FormData to the dryRun endpoint and renders the preview", async () => {
    renderPage();
    const file = jsonFile();

    selectFile(file);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mockPost.mock.calls[0];
    expect(path).toBe("/api/workspaces/ws-1/import?dryRun=true");
    expect(body).toBeInstanceOf(FormData);
    if (body instanceof FormData) {
      expect(body.get("file")).toBe(file);
    }

    // Detected-format badge + file name
    expect(await screen.findByText("Trello")).toBeInTheDocument();
    expect(screen.getByText("export.json")).toBeInTheDocument();

    // Counts table
    expect(rowFor("Projects")).toHaveTextContent("2");
    expect(rowFor("Task groups")).toHaveTextContent("5");
    expect(rowFor("Tasks")).toHaveTextContent("42");
    expect(rowFor("Labels")).toHaveTextContent("6");
    expect(rowFor("Subtasks")).toHaveTextContent("10");
    expect(rowFor("Comments")).toHaveTextContent("3");

    // Unmatched users: name, email, task count
    expect(screen.getByText(/Ghost User/)).toBeInTheDocument();
    expect(screen.getByText(/ghost@example\.com/)).toBeInTheDocument();
    expect(screen.getByText("7 tasks")).toBeInTheDocument();

    // Skipped summary: only the non-zero rows ("Invitations" is zero in the
    // fixture and collides with nothing else on the page — its absence
    // proves zero rows are filtered out)
    expect(rowFor("Attachments")).toHaveTextContent("4");
    expect(rowFor("Archived (closed) items")).toHaveTextContent("9");
    expect(screen.queryByText("Invitations")).not.toBeInTheDocument();

    // Warnings
    expect(
      screen.getByText("2 recurrence parents were not found in the file and were cleared."),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 4. Confirm — disabled until preview, re-POSTs the SAME file, then report
  // -------------------------------------------------------------------------

  it("disables the confirm button until a preview succeeds", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("re-POSTs the same File without dryRun on confirm and renders the report", async () => {
    mockPost.mockImplementation((path) =>
      path.includes("dryRun=true")
        ? Promise.resolve(previewFixture)
        : Promise.resolve(resultFixture),
    );
    const { user } = renderPage();
    const file = jsonFile();

    selectFile(file);
    const confirm = await screen.findByRole("button", { name: "Import 2 projects" });
    expect(confirm).toBeEnabled();

    await user.click(confirm);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
    const [commitPath, commitBody] = mockPost.mock.calls[1];
    expect(commitPath).toBe("/api/workspaces/ws-1/import");
    expect(commitBody).toBeInstanceOf(FormData);
    if (commitBody instanceof FormData) {
      // Object identity: the stateless dry-run contract requires the exact
      // File that produced the preview to be re-uploaded.
      expect(commitBody.get("file")).toBe(file);
    }

    // Report: rollback summary, created counts, failed project with error
    expect(
      await screen.findByText("Imported 1 project; 1 failed and was rolled back."),
    ).toBeInTheDocument();
    expect(rowFor("Tasks")).toHaveTextContent("20");
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(
      screen.getByText("UNIQUE constraint failed: task_group.position"),
    ).toBeInTheDocument();

    // Reset path returns to the upload state
    await user.click(screen.getByRole("button", { name: "Import another file" }));
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 5. Client-side size gate
  // -------------------------------------------------------------------------

  it("rejects an oversize file client-side without POSTing", async () => {
    renderPage();

    selectFile(oversizeFile());

    expect(
      await screen.findByText("File is too large — the limit is 20.0 MB."),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON file client-side without POSTing", async () => {
    renderPage();

    selectFile(new File(["hi"], "notes.txt", { type: "text/plain" }));

    expect(
      await screen.findByText("That doesn't look like a .json export file."),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. Server error states
  // -------------------------------------------------------------------------

  it("shows the server's message in an alert on a 400 response", async () => {
    mockPost.mockRejectedValue(
      new ApiError(400, "Invalid file: projects[0].name must not be empty"),
    );
    renderPage();

    selectFile(jsonFile());

    expect(
      await screen.findByText("Invalid file: projects[0].name must not be empty"),
    ).toBeInTheDocument();
    // No preview was produced, so the confirm button stays disabled
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("shows a friendly size message on a 413 response", async () => {
    mockPost.mockRejectedValue(new ApiError(413, "Payload Too Large"));
    renderPage();

    selectFile(jsonFile());

    expect(
      await screen.findByText("That file is too large to import — the limit is 20.0 MB."),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 7. Non-admin read-only state
  // -------------------------------------------------------------------------

  it("renders both cards read-only with an explanation for non-admins", () => {
    mockCanManage = false;
    renderPage();

    // Page-level explanation
    expect(
      screen.getByText(/Only workspace owners and admins can export or import/),
    ).toBeInTheDocument();

    // Export: the download is a disabled button, not a live link
    expect(
      screen.queryByRole("link", { name: "Download workspace (JSON)" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download workspace (JSON)" })).toBeDisabled();
    expect(screen.getByLabelText("Include activity history")).toBeDisabled();

    // Import: explanatory line, dead file input, disabled confirm
    expect(
      screen.getByText("Importing data requires the owner or admin role in this workspace."),
    ).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[type="file"]')).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });
});

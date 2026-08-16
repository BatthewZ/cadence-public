/**
 * Tests for how the task detail panel adopts server data.
 *
 * Why these matter: the panel keeps a LOCAL copy of the task so optimistic edits
 * render instantly. Reconciling that copy with refetched server data is the only
 * path by which a collaborator's edit reaches an open panel, and it used to merge
 * an allowlist of three fields (`subtasks`, `commentCount`, `labels`) onto the
 * local copy — so a teammate's new description was fetched and then silently
 * discarded. The panel looked live (the board behind it kept updating) while
 * showing data frozen at the moment it opened.
 *
 * The tension is real, not hypothetical: taking the server row wholesale is what
 * makes collaboration work, and is also exactly what could stomp on the local
 * user mid-keystroke. So the suite pins both directions —
 *
 *   - remote edits to any field reach the screen (the bug), and
 *   - an open description draft and a focused title input survive a refetch
 *     landing underneath them (the reason the narrow merge existed at all).
 *
 * The third hazard — a poll repainting over an unacknowledged optimistic write —
 * is NOT defended here. It is suppressed upstream by `freshnessTracker`, so what
 * this file pins is that the mutations announce themselves in `onMutate`; the
 * suppression behaviour itself belongs to use-project-freshness.test.tsx.
 *
 * Delete either half and the other becomes a regression waiting to happen.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { queryKeys } from "@/web/lib/query-keys";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

// ---------------------------------------------------------------------------
// Mocks — heavy collaborators only. `useTaskEditing` and `EditableMarkdown` stay
// REAL: they own the dirty-field and draft guards these tests are about.
// ---------------------------------------------------------------------------

vi.mock("@/web/lib/api/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/web/lib/api/client")>(
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

const updateTaskInContext = vi.fn();

vi.mock("@/web/contexts/ProjectContext", () => ({
  useProject: () => ({
    project: { id: "proj-1", name: "Test Project", workspaceId: "ws-1" },
    members: [],
    taskGroups: [{ id: "g-1", name: "To Do", isCompletionGroup: false, position: "a0" }],
    tasks: [],
    refetchTasks: vi.fn(),
    addTask: vi.fn(),
    updateTask: updateTaskInContext,
    removeTask: vi.fn(),
  }),
}));

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws-1", name: "Test Workspace", slug: "test" },
    members: [],
  }),
}));

vi.mock("@/web/components/ui/AppShell", () => ({
  useAppShell: () => ({ isMobile: false }),
}));

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-2", name: "Bob" } } }),
}));

vi.mock("@/web/hooks/use-permissions", () => ({
  useProjectPermissions: () => ({ canEditTasks: true }),
}));

vi.mock("@/web/hooks/use-task-comments", () => ({
  useTaskComments: () => ({
    comments: [],
    isLoading: false,
    isError: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
}));

// Display-only children: irrelevant to reconciliation, expensive to satisfy.
vi.mock("@/web/pages/TaskDetail/TaskActivityFeed", () => ({
  TaskActivityFeed: () => <div data-testid="activity-feed" />,
}));
vi.mock("@/web/pages/TaskDetail/TaskAttachmentSection", () => ({
  TaskAttachmentSection: () => <div data-testid="attachments" />,
}));
vi.mock("@/web/pages/TaskDetail/components/TaskCommentSection", () => ({
  TaskCommentSection: () => <div data-testid="comments" />,
}));
vi.mock("@/web/pages/TaskDetail/components/TaskSubtaskList", () => ({
  TaskSubtaskList: () => <div data-testid="subtasks" />,
}));
vi.mock("@/web/components/ui/CoverImage", () => ({
  CoverImage: () => <div data-testid="cover" />,
}));

// Renders the fields a collaborator can change, so remote updates are assertable
// without depending on the real properties UI's internals.
vi.mock("@/web/pages/TaskDetail/components/TaskDetailProperties", () => ({
  TaskDetailProperties: ({ task }: { task: TaskDetail | null }) => (
    <div>
      <span data-testid="priority">{task?.priority}</span>
      <span data-testid="assignee">{task?.assigneeName ?? "unassigned"}</span>
      <span data-testid="due">{task?.dueDate ?? "none"}</span>
    </div>
  ),
}));

import { api } from "@/web/lib/api/client";

import { TaskDetailPanelInner } from "./TaskDetailPanelInner";

// Typed as promise-returning so `mockImplementation` may route by URL without
// tripping no-misused-promises (the bare `vi.fn()` shape infers a void return).
const mockGet = api.get as unknown as Mock<(url: string) => Promise<unknown>>;
const mockPatch = api.patch as unknown as Mock<
  (url: string, body?: unknown) => Promise<unknown>
>;

const TASK_ID = "task-1";
const DETAIL_KEY = queryKeys.tasks.detail(TASK_ID);

function makeTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: TASK_ID,
    projectId: "proj-1",
    title: "Original title",
    description: "Original description",
    taskGroupId: "g-1",
    priority: "none",
    completed: false,
    position: "a0",
    subtasks: [],
    commentCount: 0,
    labels: [],
    ...overrides,
  } as TaskDetail;
}

let qc: QueryClient;

function renderPanel() {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaskDetailPanelInner
          taskId={TASK_ID}
          panelRef={createRef<HTMLDivElement>()}
          members={[]}
          toast={vi.fn()}
          onClose={vi.fn()}
          visible
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Let the notification scheduler, re-render, and seed effect settle. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Simulate the freshness poll pulling a collaborator's edit into the cache. */
async function remoteEdit(task: TaskDetail) {
  mockGet.mockImplementation((url: string) =>
    url === `/api/tasks/${TASK_ID}`
      ? Promise.resolve({ task })
      : Promise.resolve({}),
  );
  await act(async () => {
    await qc.refetchQueries({ queryKey: DETAIL_KEY });
  });
  await flush();
}

beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mockGet.mockImplementation((url: string) =>
    url === `/api/tasks/${TASK_ID}`
      ? Promise.resolve({ task: makeTask() })
      : Promise.resolve({}),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  qc.clear();
});

describe("TaskDetailPanelInner — adopting server data", () => {
  describe("remote edits reach an open panel", () => {
    it("shows a collaborator's new description", async () => {
      renderPanel();
      await waitFor(() =>
        expect(screen.getByText("Original description")).toBeTruthy(),
      );

      await remoteEdit(makeTask({ description: "Alice rewrote this" }));

      expect(screen.getByText("Alice rewrote this")).toBeTruthy();
      expect(screen.queryByText("Original description")).toBeNull();
    });

    it("shows a collaborator's new title", async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText("Original title")).toBeTruthy());

      await remoteEdit(makeTask({ title: "Renamed by Alice" }));

      expect(screen.getByText("Renamed by Alice")).toBeTruthy();
    });

    it("shows collaborator changes to properties, not just text fields", async () => {
      renderPanel();
      await waitFor(() =>
        expect(screen.getByTestId("priority").textContent).toBe("none"),
      );

      await remoteEdit(
        makeTask({
          priority: "high",
          assigneeName: "Alice",
          dueDate: "2026-09-01T00:00:00.000Z",
        }),
      );

      expect(screen.getByTestId("priority").textContent).toBe("high");
      expect(screen.getByTestId("assignee").textContent).toBe("Alice");
      expect(screen.getByTestId("due").textContent).toBe(
        "2026-09-01T00:00:00.000Z",
      );
    });

    it("keeps applying edits across several polls", async () => {
      // The reported symptom was updates arriving once and then stopping, so one
      // successful refetch is not enough evidence.
      renderPanel();
      await waitFor(() =>
        expect(screen.getByText("Original description")).toBeTruthy(),
      );

      await remoteEdit(makeTask({ description: "First edit" }));
      expect(screen.getByText("First edit")).toBeTruthy();

      await remoteEdit(makeTask({ description: "Second edit" }));
      expect(screen.getByText("Second edit")).toBeTruthy();

      await remoteEdit(makeTask({ description: "Third edit" }));
      expect(screen.getByText("Third edit")).toBeTruthy();
    });
  });

  describe("local editing survives a refetch landing underneath it", () => {
    it("does not clobber an open description draft", async () => {
      const user = userEvent.setup();
      renderPanel();
      await waitFor(() =>
        expect(screen.getByText("Original description")).toBeTruthy(),
      );

      await user.click(screen.getByText("Original description"));
      const textarea = await screen.findByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "my unsaved work");

      await remoteEdit(makeTask({ description: "Alice rewrote this" }));

      expect((textarea as HTMLTextAreaElement).value).toBe("my unsaved work");
    });

    it("does not clobber a title the user is actively typing", async () => {
      const user = userEvent.setup();
      renderPanel();
      await waitFor(() => expect(screen.getByText("Original title")).toBeTruthy());

      await user.click(screen.getByText("Original title"));
      const input = await screen.findByDisplayValue("Original title");
      await user.clear(input);
      await user.type(input, "my draft title");

      await remoteEdit(makeTask({ title: "Renamed by Alice" }));

      expect((input as HTMLInputElement).value).toBe("my draft title");
    });

    it("opens the freshness suppression window when a write STARTS, not when it finishes", async () => {
      // This is the whole protection against a poll repainting the pre-write
      // value over an optimistic one. Recording only at settle (the original
      // behaviour) leaves the entire request in flight unguarded, and the poll
      // cycle is shorter than a slow PATCH. Asserting it while the request is
      // deliberately still pending is the only way to tell the two apart.
      const recordSpy = vi.spyOn(freshnessTracker, "recordMutation");
      mockPatch.mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderPanel();
      await waitFor(() => expect(screen.getByText("Original title")).toBeTruthy());

      await user.click(screen.getByText("Original title"));
      const input = await screen.findByDisplayValue("Original title");
      await user.clear(input);
      await user.type(input, "Locally renamed");
      await act(async () => {
        input.blur();
        await Promise.resolve();
      });

      await waitFor(() => expect(mockPatch).toHaveBeenCalled());
      expect(recordSpy).toHaveBeenCalledWith("tasks");
    });

    it("keeps the optimistic value on screen until the write settles", async () => {
      // The optimistic title has to survive the whole pending window and then be
      // replaced by the server row — which, by then, also carries whatever the
      // collaborator changed in the meantime.
      let resolvePatch: (value: { task: TaskDetail }) => void = () => {};
      mockPatch.mockImplementation(
        () =>
          new Promise<{ task: TaskDetail }>((resolve) => {
            resolvePatch = resolve;
          }),
      );

      const user = userEvent.setup();
      renderPanel();
      await waitFor(() => expect(screen.getByText("Original title")).toBeTruthy());

      await user.click(screen.getByText("Original title"));
      const input = await screen.findByDisplayValue("Original title");
      await user.clear(input);
      await user.type(input, "Locally renamed");
      await act(async () => {
        input.blur();
        await Promise.resolve();
      });
      await waitFor(() => expect(mockPatch).toHaveBeenCalled());

      await flush();
      expect(screen.getByText("Locally renamed")).toBeTruthy();

      mockGet.mockImplementation((url: string) =>
        url === `/api/tasks/${TASK_ID}`
          ? Promise.resolve({
              task: makeTask({
                title: "Locally renamed",
                description: "Alice edited meanwhile",
              }),
            })
          : Promise.resolve({}),
      );
      await act(async () => {
        resolvePatch({ task: makeTask({ title: "Locally renamed" }) });
        await Promise.resolve();
      });
      await flush();

      await waitFor(() =>
        expect(screen.getByText("Alice edited meanwhile")).toBeTruthy(),
      );
      expect(screen.getByText("Locally renamed")).toBeTruthy();
    });
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const sendWriteMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/web/lib/offline/send-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/web/lib/offline/send-write")>();
  sendWriteMock.mockImplementation(actual.sendWrite);
  return { ...actual, sendWrite: sendWriteMock };
});

vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>("@/web/lib/api/client");
  return {
    ...actual,
    api: Object.assign(vi.fn(), { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }),
  };
});

vi.mock("@/web/hooks/use-project-freshness", () => ({ useProjectFreshness: vi.fn() }));
vi.mock("@/web/components/ui/ToastContext", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1", name: "Ada", image: null } } }),
}));

import { ProjectProvider, type Task, type TaskGroup, useProject } from "@/web/contexts/ProjectContext";
import { api, ApiError } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

import { AddTaskInline } from "./AddTaskForm";

const mockGet = api.get as unknown as Mock<(url: string) => Promise<unknown>>;
const mockPost = api.post as unknown as Mock<(url: string, body: unknown) => Promise<unknown>>;

const GROUP: TaskGroup = { id: "g-1", name: "To do", isCompletionGroup: false, position: "a0" };
const EXISTING: Task = { id: "t-1", title: "Existing", taskGroupId: "g-1", priority: "none", completed: false, position: "a0" };

let autoAssignCreator = false;

function respond(url: string): Promise<unknown> {
  if (url === "/api/projects/p-1") {
    return Promise.resolve({ project: { id: "p-1", name: "Launch", workspaceId: "ws-1", autoAssignCreator } });
  }
  if (url === "/api/projects/p-1/tasks") return Promise.resolve({ tasks: [EXISTING] });
  if (url === "/api/projects/p-1/task-groups") return Promise.resolve({ taskGroups: [GROUP] });
  return Promise.resolve({ members: [] });
}

function Board() {
  const { tasks } = useProject();
  return (
    <ul>
      {tasks.map((t) => (
        <li key={t.id} data-testid={`card-${t.title}`}>
          {t.title} · {t.position} · {t.assigneeName ?? "unassigned"}
        </li>
      ))}
    </ul>
  );
}

function LocationSpy() {
  return <div data-testid="search">{useLocation().search}</div>;
}

let qc: QueryClient;

function renderForm() {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProjectProvider projectId="p-1">
          <Board />
          <AddTaskInline groupId="g-1" />
          <LocationSpy />
        </ProjectProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function submit(title: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /add task/i }));
  const input = await screen.findByPlaceholderText("Task name...");
  await user.type(input, `${title}{Enter}`);
  return input as HTMLInputElement;
}

function createdId(): string {
  const body = mockPost.mock.calls[0][1] as { id: string };
  return body.id;
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockGet.mockImplementation(respond);
  autoAssignCreator = false;
});

afterEach(() => {
  qc.clear();
  vi.clearAllMocks();
});

describe("AddTaskInline — optimistic create", () => {
  it("shows the task before the server answers, then adopts the server's row", async () => {
    let answer: (value: { task: Task }) => void = () => {};
    mockPost.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderForm();
    await screen.findByText(/Existing/);

    await submit("Write the brief");

    const card = await screen.findByTestId("card-Write the brief");
    expect(card.textContent).toContain("unassigned");
    expect(mockPost).toHaveBeenCalledWith("/api/projects/p-1/tasks", {
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      title: "Write the brief",
      taskGroupId: "g-1",
    });
    const optimisticPosition = card.textContent?.split(" · ")[1];
    expect(optimisticPosition && optimisticPosition > EXISTING.position).toBe(true);

    answer({ task: { id: createdId(), title: "Write the brief", taskGroupId: "g-1", priority: "none", completed: false, position: "zz", assigneeName: "Server" } });

    await waitFor(() => expect(screen.getByTestId("card-Write the brief").textContent).toContain("zz · Server"));
    expect(screen.getAllByTestId("card-Write the brief")).toHaveLength(1);
    expect(screen.getByTestId("search").textContent).toBe(`?task=${createdId()}`);
  });

  it("assigns the optimistic card to the creator when the project auto-assigns", async () => {
    autoAssignCreator = true;
    mockPost.mockImplementation(() => new Promise(() => {}));
    renderForm();
    await screen.findByText(/Existing/);

    await submit("Mine");

    expect((await screen.findByTestId("card-Mine")).textContent).toContain("Ada");
  });

  it("removes the task and explains why when the server refuses it", async () => {
    mockPost.mockRejectedValue(new ApiError(403, "You can't add tasks to this project"));
    renderForm();
    await screen.findByText(/Existing/);

    const input = await submit("Not allowed");

    await waitFor(() => expect(screen.queryByTestId("card-Not allowed")).toBeNull());
    expect(toastMock).toHaveBeenCalledWith("You can't add tasks to this project", { variant: "error" });
    expect(input.value).toBe("Not allowed");
  });

  it("keeps the optimistic task and opens it from the cache when the create is queued", async () => {
    sendWriteMock.mockResolvedValueOnce({ status: "queued" });
    renderForm();
    await screen.findByText(/Existing/);

    await submit("Offline idea");

    const card = await screen.findByTestId("card-Offline idea");
    const request = sendWriteMock.mock.calls[0][0] as { body: { id: string }; label: string };
    expect(request.label).toBe("Create “Offline idea”");
    const id = request.body.id;
    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe(`?task=${id}`));
    expect(card.textContent).toContain("unassigned");
    expect(mockPost).not.toHaveBeenCalled();
    const detail = qc.getQueryData<{ task: TaskDetail }>(queryKeys.tasks.detail(id));
    expect(detail?.task).toMatchObject({ id, title: "Offline idea", subtasks: [], commentCount: 0, projectId: "p-1" });
  });
});

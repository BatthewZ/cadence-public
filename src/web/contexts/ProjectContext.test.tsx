import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>("@/web/lib/api/client");
  return {
    ...actual,
    api: Object.assign(vi.fn(), { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }),
  };
});

vi.mock("@/web/hooks/use-project-freshness", () => ({ useProjectFreshness: vi.fn() }));

import { api } from "@/web/lib/api/client";

import { type ProjectContextValue, ProjectProvider, type Task, useProject } from "./ProjectContext";

const mockGet = api.get as unknown as Mock<(url: string) => Promise<unknown>>;

const TASK: Task = { id: "t-1", title: "Write report", taskGroupId: "g-1", priority: "none", completed: false, position: "a0" };

function respond(url: string): Promise<unknown> {
  if (url === "/api/projects/p-1") return Promise.resolve({ project: { id: "p-1", name: "Launch", workspaceId: "ws-1" } });
  if (url === "/api/projects/p-1/tasks") return Promise.resolve({ tasks: [TASK] });
  if (url === "/api/projects/p-1/task-groups") return Promise.resolve({ taskGroups: [] });
  return Promise.resolve({ members: [] });
}

const probe: { ctx: ProjectContextValue | null } = { ctx: null };
function Probe() {
  const value = useProject();
  useEffect(() => {
    probe.ctx = value;
  });
  return <ul>{value.tasks.map((t) => <li key={t.id}>{t.title}</li>)}</ul>;
}

function renderProvider(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <ProjectProvider projectId="p-1">
        <Probe />
      </ProjectProvider>
    </QueryClientProvider>,
  );
}

let qc: QueryClient;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockGet.mockImplementation(respond);
  probe.ctx = null;
});

afterEach(() => {
  onlineManager.setOnline(true);
  qc.clear();
  vi.clearAllMocks();
});

describe("ProjectProvider offline", () => {
  it("says the project isn't on this device when it was never loaded and there's no connection", async () => {
    onlineManager.setOnline(false);
    renderProvider(qc);

    expect(await screen.findByText("You’re offline")).toBeTruthy();
    expect(screen.getByText(/This project hasn’t been opened on this device yet/)).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("renders the saved project offline when it was loaded before", async () => {
    qc.setQueryData(["projects", "p-1"], { project: { id: "p-1", name: "Launch", workspaceId: "ws-1" } });
    qc.setQueryData(["projects", "p-1", "tasks"], { tasks: [TASK] });
    onlineManager.setOnline(false);
    renderProvider(qc);

    expect(await screen.findByText("Write report")).toBeTruthy();
    expect(screen.queryByText("You’re offline")).toBeNull();
  });
});

describe("ProjectProvider optimistic helpers", () => {
  it("addTask replaces an optimistic task with the server row of the same id", async () => {
    renderProvider(qc);
    await screen.findByText("Write report");

    act(() => probe.ctx!.addTask({ ...TASK, id: "t-2", title: "Draft" }));
    expect(await screen.findByText("Draft")).toBeTruthy();

    act(() => probe.ctx!.addTask({ ...TASK, id: "t-2", title: "Draft (server)" }));
    expect(await screen.findByText("Draft (server)")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("removeTask returns an undo that puts the task back", async () => {
    renderProvider(qc);
    await screen.findByText("Write report");

    let restore: () => void = () => {};
    act(() => {
      restore = probe.ctx!.removeTask("t-1");
    });
    await waitFor(() => expect(screen.queryByText("Write report")).toBeNull());

    act(() => restore());
    expect(await screen.findByText("Write report")).toBeTruthy();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Task, TaskGroup } from "@/web/contexts/ProjectContext";

const sendWriteMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const ctx = vi.hoisted(() => ({
  addTask: vi.fn(),
  updateTask: vi.fn(),
  removeTask: vi.fn(),
  tasks: [] as Task[],
  members: [],
  taskGroups: [] as TaskGroup[],
}));

// Bulk actions batch their writes; each request still goes through the per-write mock.
vi.mock("@/web/lib/offline/send-write", () => ({
  sendWrites: (requests: unknown[]): unknown[] => requests.map((request): unknown => sendWriteMock(request)),
}));
vi.mock("@/web/contexts/ProjectContext", () => ({ useProject: () => ctx }));
vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ workspace: { id: "ws-1" }, members: [] }),
}));
vi.mock("@/web/components/ui/ToastContext", () => ({ useToast: () => ({ toast: toastMock }) }));

// The dropdowns' menus are not under test; each stands in as one button that picks a value.
vi.mock("./PriorityDropdown", () => ({
  PriorityDropdown: ({ onSelect }: { onSelect: (p: string) => void }) => (
    <button type="button" onClick={() => onSelect("high")}>Priority</button>
  ),
}));
vi.mock("./MoveToGroupDropdown", () => ({
  MoveToGroupDropdown: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect("g-done")}>Move</button>
  ),
}));
vi.mock("@/web/components/ui/ConfirmDialog", () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <button type="button" onClick={onConfirm}>Confirm delete</button> : null,
}));

import { ApiError } from "@/web/lib/api/client";

import { BulkActionBar } from "./BulkActionBar";

const TASKS: Task[] = [
  { id: "t-1", title: "One", taskGroupId: "g-todo", priority: "none", completed: false, position: "a0" },
  { id: "t-2", title: "Two", taskGroupId: "g-todo", priority: "low", completed: false, position: "a1" },
];

function renderBar() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BulkActionBar selectedIds={new Set(["t-1", "t-2"])} onClearSelection={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  ctx.tasks = TASKS;
  ctx.taskGroups = [
    { id: "g-todo", name: "To do", isCompletionGroup: false, position: "a0" },
    { id: "g-done", name: "Done", isCompletionGroup: true, position: "a1" },
  ];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("BulkActionBar with queued writes", () => {
  it("reports queued priority changes as done and keeps them on screen", async () => {
    sendWriteMock.mockResolvedValue({ status: "queued" });
    renderBar();

    await userEvent.click(screen.getByRole("button", { name: "Priority" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith("Updated 2 tasks", { variant: "success" }));
    expect(sendWriteMock).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/api/tasks/t-2",
      body: { priority: "high" },
      label: "Set priority of “Two”",
    });
    expect(ctx.updateTask).toHaveBeenCalledTimes(2);
  });

  it("keeps a queued move optimistic instead of applying a reply it never got", async () => {
    sendWriteMock.mockResolvedValue({ status: "queued" });
    renderBar();

    await userEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith("Moved 2 tasks", { variant: "success" }));
    expect(ctx.updateTask.mock.calls).toEqual([
      ["t-1", { taskGroupId: "g-done", completed: true }],
      ["t-2", { taskGroupId: "g-done", completed: true }],
    ]);
  });
});

describe("BulkActionBar delete", () => {
  it("removes every task at once and restores only the ones the server refused", async () => {
    const restoreOne = vi.fn();
    const restoreTwo = vi.fn();
    ctx.removeTask.mockImplementation((id: string) => (id === "t-1" ? restoreOne : restoreTwo));
    sendWriteMock.mockImplementation(({ path }: { path: string }) =>
      path === "/api/tasks/t-1" ? Promise.resolve({ status: "queued" }) : Promise.reject(new ApiError(403, "No")),
    );
    renderBar();

    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith("Failed to delete 1 of 2 tasks", { variant: "error" }));
    expect(ctx.removeTask).toHaveBeenCalledWith("t-1");
    expect(ctx.removeTask).toHaveBeenCalledWith("t-2");
    expect(restoreOne).not.toHaveBeenCalled();
    expect(restoreTwo).toHaveBeenCalledTimes(1);
  });
});

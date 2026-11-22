import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { Task, TaskGroup } from "@/web/contexts/ProjectContext";
import { queryKeys } from "@/web/lib/query-keys";

import { completionChange, completionFields } from "./task-writes";

const P = "p1";
const NOW = new Date("2026-11-22T10:00:00.000Z");
const group = (id: string, position: string, isCompletionGroup = false) => ({ id, position, isCompletionGroup }) as TaskGroup;
const task = (id: string, taskGroupId: string, position: string, completed = false) =>
  ({ id, taskGroupId, position, completed, completedAt: null }) as unknown as Task;

function cache(groups: TaskGroup[], tasks: Task[]) {
  const qc = new QueryClient();
  qc.setQueryData(queryKeys.projects.taskGroups(P), { taskGroups: groups });
  qc.setQueryData(queryKeys.projects.tasks(P), { tasks });
  return qc;
}

// Groups listed out of order on purpose: the server picks by position.
const groups = [group("done", "a3", true), group("todo", "a1"), group("doing", "a2"), group("archive", "a4", true)];

describe("completionChange (mirrors handlers/completion.ts)", () => {
  it("completing moves the task to the top of the first completion group", () => {
    const qc = cache(groups, [task("t1", "todo", "a0"), task("d1", "done", "a5", true), task("d2", "done", "a7", true)]);
    const change = completionChange(qc, P, "t1", true, NOW);
    expect(change).toMatchObject({ completed: true, completedAt: NOW.toISOString(), taskGroupId: "done" });
    expect(change.position! < "a5").toBe(true);
  });

  it("completing a task already in the first completion group leaves it where it is", () => {
    const qc = cache(groups, [task("t1", "done", "a0")]);
    expect(completionChange(qc, P, "t1", true, NOW)).toEqual({ completed: true, completedAt: NOW.toISOString() });
  });

  it("completing a task in another completion group still moves it to the first, as the server does", () => {
    const qc = cache(groups, [task("t1", "archive", "a0")]);
    expect(completionChange(qc, P, "t1", true, NOW)).toMatchObject({ taskGroupId: "done" });
  });

  it("reopening moves a task out of a completion group to the top of the first other group", () => {
    const qc = cache(groups, [task("t1", "done", "a0", true), task("o1", "todo", "a2")]);
    const change = completionChange(qc, P, "t1", false, NOW);
    expect(change).toMatchObject({ completed: false, completedAt: null, taskGroupId: "todo" });
    expect(change.position! < "a2").toBe(true);
  });

  it("reopening a task outside a completion group only clears completion", () => {
    const qc = cache(groups, [task("t1", "doing", "a0", true)]);
    expect(completionChange(qc, P, "t1", false, NOW)).toEqual({ completed: false, completedAt: null });
  });

  it("without the project's groups or tasks cached, only completion changes", () => {
    expect(completionChange(new QueryClient(), P, "t1", true, NOW)).toEqual({ completed: true, completedAt: NOW.toISOString() });
    expect(completionChange(cache(groups, []), undefined, "t1", true, NOW)).toEqual({ completed: true, completedAt: NOW.toISOString() });
  });

  it("completionFields captures exactly what a rollback puts back", () => {
    expect(completionFields(task("t1", "todo", "a0"))).toEqual({ completed: false, completedAt: null, taskGroupId: "todo", position: "a0" });
  });
});

import { describe, expect, it } from "vitest";

import { queryKeys } from "./query-keys";

describe("queryKeys", () => {
  describe("tasks.comments", () => {
    it("returns the correct key structure", () => {
      expect(queryKeys.tasks.comments("task-1")).toEqual(["tasks", "task-1", "comments"]);
    });

    it("produces distinct keys for different task ids", () => {
      expect(queryKeys.tasks.comments("a")).not.toEqual(queryKeys.tasks.comments("b"));
    });

    it("shares a common prefix with tasks.detail for invalidation", () => {
      const commentsKey = queryKeys.tasks.comments("task-1");
      const detailKey = queryKeys.tasks.detail("task-1");
      // Both start with ["tasks", "task-1"]
      expect(commentsKey.slice(0, 2)).toEqual(detailKey);
    });
  });

  describe("tasks.activity", () => {
    it("returns the correct key structure", () => {
      expect(queryKeys.tasks.activity("task-1")).toEqual(["tasks", "task-1", "activity"]);
    });

    it("produces distinct keys for different task ids", () => {
      expect(queryKeys.tasks.activity("a")).not.toEqual(queryKeys.tasks.activity("b"));
    });

    it("shares a common prefix with tasks.detail for invalidation", () => {
      const activityKey = queryKeys.tasks.activity("task-1");
      const detailKey = queryKeys.tasks.detail("task-1");
      expect(activityKey.slice(0, 2)).toEqual(detailKey);
    });

    it("is distinct from tasks.comments for the same task", () => {
      expect(queryKeys.tasks.activity("task-1")).not.toEqual(queryKeys.tasks.comments("task-1"));
    });
  });

  describe("workspaces.dashboardUpcoming", () => {
    it("returns the correct key structure", () => {
      expect(queryKeys.workspaces.dashboardUpcoming("ws-1")).toEqual([
        "workspaces",
        "ws-1",
        "dashboard",
        "upcoming",
      ]);
    });

    it("produces distinct keys for different workspace ids", () => {
      expect(queryKeys.workspaces.dashboardUpcoming("ws-1")).not.toEqual(
        queryKeys.workspaces.dashboardUpcoming("ws-2"),
      );
    });

    it("shares a common prefix with workspaces.dashboard for invalidation", () => {
      const upcomingKey = queryKeys.workspaces.dashboardUpcoming("ws-1");
      const dashboardKey = queryKeys.workspaces.dashboard("ws-1");
      // Invalidating ["workspaces", "ws-1", "dashboard"] covers both
      expect(upcomingKey.slice(0, 3)).toEqual(dashboardKey);
    });

    it("is distinct from dashboardMyTasks for the same workspace", () => {
      expect(queryKeys.workspaces.dashboardUpcoming("ws-1")).not.toEqual(
        queryKeys.workspaces.dashboardMyTasks("ws-1"),
      );
    });
  });

  describe("notifications.list", () => {
    it("returns the correct key structure without filters", () => {
      expect(queryKeys.notifications.list()).toEqual(["notifications", "list", undefined]);
    });

    it("returns the correct key structure with filters", () => {
      expect(queryKeys.notifications.list({ unreadOnly: true })).toEqual([
        "notifications",
        "list",
        { unreadOnly: true },
      ]);
    });

    it("produces distinct keys for different filter states", () => {
      expect(queryKeys.notifications.list({ unreadOnly: true })).not.toEqual(
        queryKeys.notifications.list({ unreadOnly: false }),
      );
    });
  });

  describe("dashboardMyTasks", () => {
    it("always includes the period segment in the key", () => {
      const withoutPeriod = queryKeys.workspaces.dashboardMyTasks("ws-1");
      const withPeriod = queryKeys.workspaces.dashboardMyTasks("ws-1", "week");

      // Both keys must have the same number of segments so that
      // prefix-based invalidation with ["workspaces", id, "dashboard", "my-tasks"]
      // clears all variants consistently.
      expect(withoutPeriod).toHaveLength(withPeriod.length);
    });

    it('defaults to "all" period with empty filter segments when no params provided', () => {
      const key = queryKeys.workspaces.dashboardMyTasks("ws-1");
      expect(key).toEqual([
        "workspaces",
        "ws-1",
        "dashboard",
        "my-tasks",
        "all",
        "",
        "",
      ]);
    });

    it("includes the provided period in the key", () => {
      expect(queryKeys.workspaces.dashboardMyTasks("ws-1", "week")).toEqual([
        "workspaces",
        "ws-1",
        "dashboard",
        "my-tasks",
        "week",
        "",
        "",
      ]);

      expect(queryKeys.workspaces.dashboardMyTasks("ws-1", "month")).toEqual([
        "workspaces",
        "ws-1",
        "dashboard",
        "my-tasks",
        "month",
        "",
        "",
      ]);
    });

    it("produces distinct keys for different filter combinations", () => {
      const allKey = queryKeys.workspaces.dashboardMyTasks("ws-1");
      const weekKey = queryKeys.workspaces.dashboardMyTasks("ws-1", "week");
      const monthKey = queryKeys.workspaces.dashboardMyTasks("ws-1", "month");
      const projectFiltered = queryKeys.workspaces.dashboardMyTasks("ws-1", "week", ["p1"]);
      const projectAndGroupFiltered = queryKeys.workspaces.dashboardMyTasks(
        "ws-1",
        "week",
        ["p1"],
        ["g1"],
      );

      expect(allKey).not.toEqual(weekKey);
      expect(allKey).not.toEqual(monthKey);
      expect(weekKey).not.toEqual(monthKey);
      expect(weekKey).not.toEqual(projectFiltered);
      expect(projectFiltered).not.toEqual(projectAndGroupFiltered);
    });

    it("shares a common prefix for invalidation", () => {
      const allKey = queryKeys.workspaces.dashboardMyTasks("ws-1");
      const weekKey = queryKeys.workspaces.dashboardMyTasks("ws-1", "week");
      const filteredKey = queryKeys.workspaces.dashboardMyTasks(
        "ws-1",
        "week",
        ["p1"],
        ["g1"],
      );
      const prefix = queryKeys.workspaces.dashboardMyTasksPrefix("ws-1");

      // All variants start with the same prefix — react-query invalidation
      // with this prefix will clear all dashboardMyTasks caches regardless
      // of period or project/task-group filters.
      expect(allKey.slice(0, 4)).toEqual(prefix);
      expect(weekKey.slice(0, 4)).toEqual(prefix);
      expect(filteredKey.slice(0, 4)).toEqual(prefix);
    });

    it("dashboardMyTasksPrefix returns the 4-segment key without period", () => {
      expect(queryKeys.workspaces.dashboardMyTasksPrefix("ws-1")).toEqual([
        "workspaces",
        "ws-1",
        "dashboard",
        "my-tasks",
      ]);
    });
  });
});

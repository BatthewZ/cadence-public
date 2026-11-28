import type { QueryKey } from "@tanstack/react-query";

/**
 * Which cached server reads are saved to this device for offline use: what the board, list,
 * timeline, calendar, task detail and dashboards need to render. Left out on purpose: search,
 * activity feeds, notifications, webhooks, API tokens, invitations and the calendar-feed status
 * (a capability's metadata) — those are online-only screens, or data a device shouldn't keep.
 */
const WORKSPACE_CHILDREN = new Set([
  "members",
  "projects",
  "labels",
  "task-groups",
  "dashboard",
  "teams",
]);
const PROJECT_CHILDREN = new Set([
  "members",
  "task-groups",
  "tasks",
  "labels",
  "saved-views",
  "dashboard",
]);
const TASK_CHILDREN = new Set(["comments", "attachments"]);

function childAllowed(key: QueryKey, children: Set<string>): boolean {
  if (key.length === 2) return typeof key[1] === "string";
  return typeof key[2] === "string" && children.has(key[2]);
}

export function isOfflineQueryKey(key: QueryKey): boolean {
  const [root] = key;
  switch (root) {
    case "workspaces":
      return key.length === 1 || childAllowed(key, WORKSPACE_CHILDREN);
    case "projects":
      return key.length >= 2 && childAllowed(key, PROJECT_CHILDREN);
    case "tasks":
      return key.length >= 2 && childAllowed(key, TASK_CHILDREN);
    case "legal":
      return key[1] === "tos-status";
    case "config":
      return key[1] === "features";
    default:
      return false;
  }
}

/** Query-key prefixes whose entries may be saved; they get a long `gcTime` so restored entries outlive a session. */
export const OFFLINE_QUERY_ROOTS = ["workspaces", "projects", "tasks", "legal", "config"] as const;

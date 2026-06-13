import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { getPriorityLabel } from "@/web/util/task-display";

export interface ActivityItem {
  id: string;
  taskId: string;
  actorId: string | null;
  actorName: string | null;
  actorImage: string | null;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  /**
   * Populated when the action was performed by a Personal Access Token
   * instead of a regular user session. Null for cookie-authenticated
   * actions and for internal system writes.
   */
  apiTokenId?: string | null;
  /**
   * Display name of the API token from the JOIN; null when there is no
   * apiTokenId, or when the token row has been hard-deleted (we keep
   * the activity row so historical attribution survives).
   */
  tokenName?: string | null;
}

/**
 * A grouped activity represents either a single activity item or
 * a collapsed group of adjacent label add/remove entries for the same
 * user and task. Grouping reduces visual noise in the activity feed
 * when users make multiple label changes in quick succession.
 */
export interface GroupedActivity<T extends ActivityItem> {
  /** The first activity in the group (used for avatar, actor info, timestamp). */
  representative: T;
  /** All original activities collapsed into this group. */
  items: T[];
  /** Whether this is a collapsed label group (items.length > 1). */
  isLabelGroup: boolean;
  /** Label names that were added in this group (empty if not a label group). */
  labelsAdded: string[];
  /** Label names that were removed in this group (empty if not a label group). */
  labelsRemoved: string[];
}

const LABEL_ACTIONS = new Set(["label_added", "label_removed"]);

/**
 * Group adjacent activity entries that share the same actor and task
 * and are all label add/remove actions into a single collapsed entry.
 * Non-label entries pass through as single-item groups.
 *
 * This prevents the feed from being dominated by repetitive
 * "added label X" / "removed label X" entries when a user updates
 * multiple labels on a task at once.
 */
export function groupLabelActivities<T extends ActivityItem>(
  activities: T[],
): GroupedActivity<T>[] {
  const groups: GroupedActivity<T>[] = [];
  let i = 0;

  while (i < activities.length) {
    const current = activities[i];

    if (!LABEL_ACTIONS.has(current.action)) {
      groups.push({
        representative: current,
        items: [current],
        isLabelGroup: false,
        labelsAdded: [],
        labelsRemoved: [],
      });
      i++;
      continue;
    }

    // Collect adjacent label entries with the same actor + task
    const batch: T[] = [current];
    let j = i + 1;
    while (
      j < activities.length &&
      LABEL_ACTIONS.has(activities[j].action) &&
      activities[j].actorId === current.actorId &&
      activities[j].taskId === current.taskId
    ) {
      batch.push(activities[j]);
      j++;
    }

    const labelsAdded: string[] = [];
    const labelsRemoved: string[] = [];
    for (const item of batch) {
      if (item.action === "label_added" && item.newValue) {
        labelsAdded.push(item.newValue);
      } else if (item.action === "label_removed" && item.newValue) {
        labelsRemoved.push(item.newValue);
      }
    }

    groups.push({
      representative: current,
      items: batch,
      isLabelGroup: batch.length > 1,
      labelsAdded,
      labelsRemoved,
    });

    i = j;
  }

  return groups;
}

/**
 * Format a grouped label activity into a human-readable message.
 * Produces messages like "updated labels (added Bug, removed Feature)".
 */
export function formatGroupedLabelMessage(
  group: GroupedActivity<ActivityItem>,
): string {
  const parts: string[] = [];
  if (group.labelsAdded.length > 0) {
    parts.push(`added ${group.labelsAdded.map((l) => `"${l}"`).join(", ")}`);
  }
  if (group.labelsRemoved.length > 0) {
    parts.push(`removed ${group.labelsRemoved.map((l) => `"${l}"`).join(", ")}`);
  }
  return `updated labels (${parts.join("; ")})`;
}

/**
 * Build the "(via <TokenName>)" suffix shown after an actor's name when
 * the activity was performed by a Personal Access Token. Returns null
 * when the activity has no apiTokenId so the caller can omit the suffix
 * entirely (and avoid a stray pair of parens for normal cookie auth).
 *
 * - apiTokenId present + tokenName present → "(via <name>)"
 * - apiTokenId present + tokenName null    → "(via deleted token)"
 *   (the token row was hard-deleted but the activity row's apiTokenId
 *    was preserved by the SET NULL contract in the schema)
 * - apiTokenId null                        → null  (cookie auth)
 */
export function formatTokenAttribution(
  activity: Pick<ActivityItem, "apiTokenId" | "tokenName">,
): string | null {
  if (!activity.apiTokenId) return null;
  const name = activity.tokenName?.trim();
  return name ? `(via ${name})` : "(via deleted token)";
}

/**
 * Format a timestamp into a human-readable relative time string.
 * Returns "just now", "Xm ago", "Xh ago", "yesterday", "Xd ago",
 * or a short date for older timestamps.
 */
export function formatRelativeTime(timestamp: string | number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Format a future-or-past timestamp into a human-readable expression of
 * remaining (or elapsed) time: "in 3 days", "in 1 year", "1 month ago",
 * "expired today". Use this when the timestamp could be on either side of now
 * (e.g. token `expiresAt`, scheduled `revokeAt`); use `formatRelativeTime`
 * for strictly past timestamps (activity, attachments, lastUsedAt).
 */
export function formatRelativeFuture(timestamp: string | number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const past = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const absSeconds = Math.floor(absMs / 1000);
  const absMinutes = Math.floor(absSeconds / 60);
  const absHours = Math.floor(absMinutes / 60);
  const absDays = Math.floor(absHours / 24);

  const phrase = (qty: number, unit: string): string => {
    const plural = qty === 1 ? unit : `${unit}s`;
    return past ? `${qty} ${plural} ago` : `in ${qty} ${plural}`;
  };

  if (absSeconds < 60) return past ? "just now" : "in a moment";
  if (absMinutes < 60) return phrase(absMinutes, "minute");
  if (absHours < 24) return phrase(absHours, "hour");
  // Round when promoting to coarser units so we never report "in 0 years"
  // for a token that expires in 364 days; the rounding bias matches the
  // visual expectation that "almost a year" reads as "in 1 year".
  if (absDays < 30) return phrase(absDays, "day");
  if (absDays < 365) return phrase(Math.round(absDays / 30), "month");
  return phrase(Math.round(absDays / 365), "year");
}

/**
 * Resolve a user ID to a display name using the workspace members list.
 * Falls back to "Someone" if the user is not found.
 */
function resolveUserName(
  userId: string | null,
  members: WorkspaceMember[],
): string {
  if (!userId) return "Someone";
  const member = members.find((m) => m.userId === userId);
  return member?.user.name ?? "Someone";
}

/**
 * Format a due date value from an activity record into a readable date.
 */
function formatActivityDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Convert a task activity record into a human-readable message string.
 * The message describes what changed (e.g., "changed priority from Low to High").
 */
export function formatActivityMessage(
  activity: ActivityItem,
  members: WorkspaceMember[],
): string {
  const { action, field, oldValue, newValue } = activity;

  switch (action) {
    case "created":
      if (newValue?.startsWith("Duplicated from:")) {
        return `duplicated this task (from "${newValue.replace("Duplicated from: ", "")}")`;
      }
      return "created this task";

    case "completed":
      return "marked as complete";

    case "reopened":
      return "reopened this task";

    case "assigned": {
      const name = resolveUserName(newValue, members);
      return `assigned to ${name}`;
    }

    case "unassigned": {
      const name = resolveUserName(oldValue, members);
      return `unassigned ${name}`;
    }

    case "moved":
      return `moved from ${oldValue ?? "unknown"} to ${newValue ?? "unknown"}`;

    case "description_updated":
      return "updated the description";

    case "priority_changed": {
      const oldLabel = oldValue ? getPriorityLabel(oldValue) : "None";
      const newLabel = newValue ? getPriorityLabel(newValue) : "None";
      return `changed priority from ${oldLabel} to ${newLabel}`;
    }

    case "title_changed":
      return "changed the title";

    case "due_date_changed": {
      const formatted = formatActivityDate(newValue);
      return `set due date to ${formatted}`;
    }

    case "due_date_removed":
      return "removed the due date";

    case "start_date_changed": {
      const formatted = formatActivityDate(newValue);
      return `set start date to ${formatted}`;
    }

    case "start_date_removed":
      return "removed the start date";

    case "comment_added": {
      const preview = newValue ? `: "${newValue}${newValue.length >= 100 ? "…" : ""}"` : "";
      return `added a comment${preview}`;
    }

    case "comment_updated":
      return "edited a comment";

    case "comment_deleted":
      return "deleted a comment";

    case "label_added":
      return `added label "${newValue}"`;

    case "label_removed":
      return `removed label "${newValue}"`;

    case "attachment_added":
      return `attached ${newValue}`;

    case "attachment_removed":
      return `removed attachment ${newValue}`;

    default:
      // Handle any future action types gracefully
      if (field && oldValue && newValue) {
        return `changed ${field} from ${oldValue} to ${newValue}`;
      }
      if (field && newValue) {
        return `set ${field} to ${newValue}`;
      }
      return `performed ${action.replace(/_/g, " ")}`;
  }
}

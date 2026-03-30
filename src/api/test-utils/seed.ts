import type { NotificationType } from "../../shared/types/roles";
import { TEST_USER, TEST_USER_2 } from "./fakes";

// ---------------------------------------------------------------------------
// Data seeding helpers
// ---------------------------------------------------------------------------

/**
 * Convert a millisecond epoch or Date to Unix seconds.
 * Drizzle ORM's `integer("col", { mode: "timestamp" })` stores dates as
 * seconds, so raw-SQL seed helpers must match that convention.
 */
function toSec(ms: number): number;
function toSec(d: Date): number;
function toSec(v: number | Date): number {
  return Math.floor((typeof v === "number" ? v : v.getTime()) / 1000);
}

/** Insert a test user into the database. */
export async function seedUser(
  d1: D1Database,
  user: typeof TEST_USER | typeof TEST_USER_2 = TEST_USER,
) {
  await d1
    .prepare(
      "INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      user.id,
      user.name,
      user.email,
      user.emailVerified ? 1 : 0,
      user.image,
      toSec(user.createdAt),
      toSec(user.updatedAt),
    )
    .run();
}

/** Insert a workspace and owner membership. Returns the workspace id. */
export async function seedWorkspace(
  d1: D1Database,
  ownerId: string,
  opts?: { id?: string; name?: string; slug?: string },
): Promise<string> {
  const id = opts?.id ?? crypto.randomUUID();
  const now = toSec(Date.now());
  await d1
    .prepare(
      "INSERT INTO workspace (id, name, slug, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, opts?.name ?? "Test Workspace", opts?.slug ?? `test-ws-${id.slice(0, 8)}`, ownerId, now, now)
    .run();

  // Add owner as workspace member
  await d1
    .prepare(
      "INSERT INTO workspace_member (id, workspaceId, userId, role, joinedAt) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), id, ownerId, "owner", now)
    .run();

  return id;
}

/** Add a user as a workspace member with a given role. */
export async function seedWorkspaceMember(
  d1: D1Database,
  workspaceId: string,
  userId: string,
  role: "owner" | "admin" | "member" = "member",
): Promise<string> {
  const id = crypto.randomUUID();
  await d1
    .prepare(
      "INSERT INTO workspace_member (id, workspaceId, userId, role, joinedAt) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, workspaceId, userId, role, toSec(Date.now()))
    .run();
  return id;
}

/** Create a project within a workspace. Returns the project id. */
export async function seedProject(
  d1: D1Database,
  workspaceId: string,
  opts?: { id?: string; name?: string; budget?: number; autoAssignCreator?: boolean },
): Promise<string> {
  const id = opts?.id ?? crypto.randomUUID();
  const now = toSec(Date.now());
  await d1
    .prepare(
      "INSERT INTO project (id, workspaceId, name, status, budget, auto_assign_creator, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, workspaceId, opts?.name ?? "Test Project", "active", opts?.budget ?? null, opts?.autoAssignCreator ? 1 : 0, now, now)
    .run();
  return id;
}

/** Add a user as a project member. Returns the membership id. */
export async function seedProjectMember(
  d1: D1Database,
  projectId: string,
  userId: string,
  role: "admin" | "member" | "viewer" = "member",
): Promise<string> {
  const id = crypto.randomUUID();
  await d1
    .prepare(
      "INSERT INTO project_member (id, projectId, userId, role, addedAt) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, projectId, userId, role, toSec(Date.now()))
    .run();
  return id;
}

/** Create a task group within a project. Returns the group id. */
export async function seedTaskGroup(
  d1: D1Database,
  projectId: string,
  opts?: { id?: string; name?: string; isCompletionGroup?: boolean; position?: string },
): Promise<string> {
  const id = opts?.id ?? crypto.randomUUID();
  await d1
    .prepare(
      "INSERT INTO task_group (id, projectId, name, is_completion_group, position, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      projectId,
      opts?.name ?? "To Do",
      opts?.isCompletionGroup ? 1 : 0,
      opts?.position ?? "a0",
      toSec(Date.now()),
      toSec(Date.now()),
    )
    .run();
  return id;
}

/** Create a task within a project/task group. Returns the task id. */
export async function seedTask(
  d1: D1Database,
  projectId: string,
  taskGroupId: string,
  opts?: {
    id?: string;
    title?: string;
    assigneeId?: string;
    completed?: boolean;
    priority?: string;
    dueDate?: Date;
    position?: string;
    description?: string;
    cost?: number;
    icon?: string;
    coverImageKey?: string;
  },
): Promise<string> {
  const id = opts?.id ?? crypto.randomUUID();
  const now = toSec(Date.now());
  await d1
    .prepare(
      `INSERT INTO task (id, projectId, taskGroupId, title, completed, priority, assigneeId, dueDate, position, description, cost, icon, cover_image_key, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      projectId,
      taskGroupId,
      opts?.title ?? "Test Task",
      opts?.completed ? 1 : 0,
      opts?.priority ?? "none",
      opts?.assigneeId ?? null,
      opts?.dueDate ? toSec(opts.dueDate) : null,
      opts?.position ?? "a0",
      opts?.description ?? null,
      opts?.cost ?? null,
      opts?.icon ?? null,
      opts?.coverImageKey ?? null,
      now,
      now,
    )
    .run();
  return id;
}

/** Create a comment on a task. Returns the comment id. */
export async function seedComment(
  d1: D1Database,
  taskId: string,
  authorId: string,
  opts?: { id?: string; body?: string; createdAt?: Date },
): Promise<string> {
  const id = opts?.id ?? crypto.randomUUID();
  const now = opts?.createdAt ? toSec(opts.createdAt) : toSec(Date.now());
  await d1
    .prepare(
      "INSERT INTO comment (id, taskId, authorId, body, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, taskId, authorId, opts?.body ?? "Test comment", now, now)
    .run();
  return id;
}

/** Create a subtask. Returns the subtask id. */
export async function seedSubtask(
  d1: D1Database,
  taskId: string,
  opts?: { id?: string; title?: string; completed?: boolean; position?: string },
): Promise<string> {
  const id = opts?.id ?? crypto.randomUUID();
  await d1
    .prepare(
      "INSERT INTO subtask (id, taskId, title, completed, position, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      taskId,
      opts?.title ?? "Test Subtask",
      opts?.completed ? 1 : 0,
      opts?.position ?? "a0",
      toSec(Date.now()),
    )
    .run();
  return id;
}

/** Create an invitation. Returns the invitation id. */
export async function seedInvitation(
  d1: D1Database,
  workspaceId: string,
  opts?: {
    id?: string;
    email?: string;
    role?: string;
    invitedBy?: string;
    token?: string;
    status?: string;
    expiresAt?: Date;
  },
): Promise<string> {
  const id = opts?.id ?? crypto.randomUUID();
  const now = toSec(Date.now());
  const expiresAt = opts?.expiresAt
    ? toSec(opts.expiresAt)
    : now + 7 * 24 * 60 * 60; // 7 days in seconds
  await d1
    .prepare(
      `INSERT INTO invitation (id, workspaceId, email, role, invitedBy, token, status, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      workspaceId,
      opts?.email ?? "invite@example.com",
      opts?.role ?? "member",
      opts?.invitedBy ?? TEST_USER.id,
      opts?.token ?? crypto.randomUUID(),
      opts?.status ?? "pending",
      expiresAt,
      now,
    )
    .run();
  return id;
}

/** Create a team. Returns the team id. */
export async function seedTeam(
  d1: D1Database,
  workspaceId: string,
  opts?: { id?: string; name?: string },
): Promise<string> {
  const id = opts?.id ?? crypto.randomUUID();
  const now = toSec(Date.now());
  await d1
    .prepare(
      "INSERT INTO team (id, workspaceId, name, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, workspaceId, opts?.name ?? "Test Team", now, now)
    .run();
  return id;
}

/** Add a user to a team. Returns the membership id. */
export async function seedTeamMember(
  d1: D1Database,
  teamId: string,
  userId: string,
  role: "lead" | "member" = "member",
): Promise<string> {
  const id = crypto.randomUUID();
  await d1
    .prepare(
      "INSERT INTO team_member (id, teamId, userId, role, joinedAt) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, teamId, userId, role, toSec(Date.now()))
    .run();
  return id;
}

/** Create a notification for a user. Returns the notification id. */
export async function seedNotification(
  d1: D1Database,
  userId: string,
  opts?: {
    id?: string;
    type?: NotificationType;
    title?: string;
    body?: string;
    read?: boolean;
    actorId?: string;
    workspaceId?: string;
    createdAt?: Date;
  },
): Promise<string> {
  const id = opts?.id ?? crypto.randomUUID();
  const now = opts?.createdAt ? toSec(opts.createdAt) : toSec(Date.now());
  await d1
    .prepare(
      `INSERT INTO notification (id, userId, type, title, body, read, actorId, workspaceId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      opts?.type ?? "task_assigned",
      opts?.title ?? "Test notification",
      opts?.body ?? null,
      opts?.read ? 1 : 0,
      opts?.actorId ?? null,
      opts?.workspaceId ?? null,
      now,
    )
    .run();
  return id;
}

/** Create a task activity record. Returns the activity id. */
export async function seedTaskActivity(
  d1: D1Database,
  taskId: string,
  actorId: string,
  opts?: {
    id?: string;
    action?: string;
    field?: string;
    oldValue?: string;
    newValue?: string;
    createdAt?: Date;
  },
): Promise<string> {
  const id = opts?.id ?? crypto.randomUUID();
  const now = opts?.createdAt ? toSec(opts.createdAt) : toSec(Date.now());
  await d1
    .prepare(
      `INSERT INTO task_activity (id, taskId, actorId, action, field, oldValue, newValue, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      taskId,
      actorId,
      opts?.action ?? "updated",
      opts?.field ?? "title",
      opts?.oldValue ?? null,
      opts?.newValue ?? null,
      now,
    )
    .run();
  return id;
}

/** Create a webhook for a workspace. Returns the created webhook object. */
export async function seedWebhook(
  d1: D1Database,
  workspaceId: string,
  opts?: {
    id?: string;
    name?: string;
    url?: string;
    secret?: string;
    events?: string;
    active?: boolean;
    consecutiveFailures?: number;
    createdAt?: Date;
    updatedAt?: Date;
  },
) {
  const id = opts?.id ?? crypto.randomUUID();
  const now = toSec(Date.now());
  const createdAt = opts?.createdAt ? toSec(opts.createdAt) : now;
  const updatedAt = opts?.updatedAt ? toSec(opts.updatedAt) : now;
  const active = opts?.active !== undefined ? (opts.active ? 1 : 0) : 1;
  const consecutiveFailures = opts?.consecutiveFailures ?? 0;
  const name = opts?.name ?? "Test Webhook";
  const url = opts?.url ?? "https://example.com/webhook";
  const secret = opts?.secret ?? "test-secret-hex-string";
  const events = opts?.events ?? JSON.stringify(["task.created"]);

  await d1
    .prepare(
      `INSERT INTO webhook (id, workspaceId, name, url, secret, events, active, consecutiveFailures, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, workspaceId, name, url, secret, events, active, consecutiveFailures, createdAt, updatedAt)
    .run();

  return { id, workspaceId, name, url, secret, events, active, consecutiveFailures, createdAt, updatedAt };
}

/** Create a webhook delivery record. Returns the created delivery object. */
export async function seedWebhookDelivery(
  d1: D1Database,
  webhookId: string,
  opts?: {
    id?: string;
    event?: string;
    payload?: string;
    statusCode?: number | null;
    response?: string | null;
    success?: boolean;
    attempts?: number;
    maxAttempts?: number;
    nextRetryAt?: Date | null;
    createdAt?: Date;
    lastAttemptAt?: Date;
  },
) {
  const id = opts?.id ?? crypto.randomUUID();
  const now = toSec(Date.now());
  const event = opts?.event ?? "task.created";
  const payload = opts?.payload ?? JSON.stringify({ test: true });
  const statusCode = opts?.statusCode !== undefined ? opts.statusCode : 200;
  const response = opts?.response !== undefined ? opts.response : "OK";
  const success = opts?.success !== undefined ? (opts.success ? 1 : 0) : 1;
  const attempts = opts?.attempts ?? 1;
  const maxAttempts = opts?.maxAttempts ?? 5;
  const nextRetryAt = opts?.nextRetryAt ? toSec(opts.nextRetryAt) : null;
  const createdAt = opts?.createdAt ? toSec(opts.createdAt) : now;
  const lastAttemptAt = opts?.lastAttemptAt ? toSec(opts.lastAttemptAt) : now;

  await d1
    .prepare(
      `INSERT INTO webhook_delivery (id, webhookId, event, payload, statusCode, response, success, attempts, maxAttempts, nextRetryAt, createdAt, lastAttemptAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, webhookId, event, payload, statusCode, response, success, attempts, maxAttempts, nextRetryAt, createdAt, lastAttemptAt)
    .run();

  return { id, webhookId, event, payload, statusCode, response, success, attempts, maxAttempts, nextRetryAt, createdAt, lastAttemptAt };
}

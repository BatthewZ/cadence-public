import type {
  ExportedComment,
  ExportedLabel,
  ExportedProject,
  ExportedSubtask,
  ExportedTask,
  ExportedTaskGroup,
  ExportedUser,
  WorkspaceExport,
} from "../../../../shared/schemas/workspace-export";
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
} from "../../../../shared/schemas/workspace-export";
import type { ImportDocument } from "../../../../shared/schemas/workspace-import";
import { importDocumentSchema } from "../../../../shared/schemas/workspace-import";

/**
 * Shared fixture builders for the import parse/executor tests.
 *
 * Every builder produces CONTRACT-VALID data by default (and `makeDoc`
 * enforces it with a real `importDocumentSchema.parse`) — important because
 * the executor's stated precondition is "validated document": a fixture
 * that drifted from the schema would test an input the engine never
 * receives in production. Constraint-violation injections (duplicate
 * positions etc.) stay Zod-valid on purpose — that is exactly the class of
 * failure the compensating-delete path exists for.
 */

export const ISO = "2026-01-15T10:00:00.000Z";

let positionCounter = 0;
/** Unique ascending fractional-index-compatible positions — the task/group/
 *  subtask tables have UNIQUE (parent, position) indexes, so fixtures must
 *  never default to a shared constant. */
export function nextPos(): string {
  positionCounter += 1;
  return `a${String(positionCounter).padStart(6, "0")}`;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function makeUser(ref: string, email: string, name = `User ${ref}`): ExportedUser {
  return { ref, email, name };
}

export function makeGroup(overrides: Partial<ExportedTaskGroup> = {}): ExportedTaskGroup {
  return {
    id: nextId("src-group"),
    name: "To Do",
    color: null,
    isCompletionGroup: false,
    position: nextPos(),
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeLabel(overrides: Partial<ExportedLabel> = {}): ExportedLabel {
  return {
    id: nextId("src-label"),
    name: `Label ${idCounter}`,
    color: "#3b82f6",
    createdAt: ISO,
    ...overrides,
  };
}

export function makeSubtask(overrides: Partial<ExportedSubtask> = {}): ExportedSubtask {
  return {
    title: "A subtask",
    completed: false,
    position: nextPos(),
    createdAt: ISO,
    ...overrides,
  };
}

export function makeComment(overrides: Partial<ExportedComment> = {}): ExportedComment {
  return {
    body: "A comment",
    authorRef: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeTask(
  taskGroupId: string,
  overrides: Partial<ExportedTask> = {},
): ExportedTask {
  return {
    id: nextId("src-task"),
    taskGroupId,
    title: "A task",
    description: null,
    assigneeRef: null,
    priority: "none",
    completed: false,
    completedAt: null,
    completedByRef: null,
    startDate: null,
    dueDate: null,
    cost: null,
    icon: null,
    coverImage: null,
    coverUnsplash: null,
    recurrenceRule: null,
    recurrenceParentId: null,
    recurrenceSeriesId: null,
    sourceUid: null,
    position: nextPos(),
    createdAt: ISO,
    updatedAt: ISO,
    labelIds: [],
    subtasks: [],
    comments: [],
    attachments: [],
    ...overrides,
  };
}

export function makeProject(overrides: Partial<ExportedProject> = {}): ExportedProject {
  return {
    id: nextId("src-project"),
    name: "Imported Project",
    description: null,
    status: "active",
    icon: null,
    coverImage: null,
    coverUnsplash: null,
    theme: null,
    budget: null,
    autoAssignCreator: false,
    position: null,
    createdAt: ISO,
    updatedAt: ISO,
    members: [],
    taskGroups: [],
    labels: [],
    tasks: [],
    ...overrides,
  };
}

/**
 * Build a contract-valid {@link ImportDocument} — parsed through the real
 * schema so a fixture that drifts from the contract fails the test that
 * uses it instead of silently testing an impossible input.
 */
export function makeDoc(
  projects: ExportedProject[],
  users: ExportedUser[] = [],
): ImportDocument {
  return importDocumentSchema.parse({ users, projects });
}

/** Full Cadence export envelope for parse-level tests. */
export function makeExportFile(overrides: Partial<WorkspaceExport> = {}): WorkspaceExport {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: ISO,
    exportedBy: "owner@example.com",
    workspace: {
      name: "Source Workspace",
      slug: "source-workspace",
      description: null,
      theme: null,
    },
    users: [],
    members: [],
    teams: [],
    webhooks: [],
    invitations: [],
    projects: [],
    ...overrides,
  };
}

/** Minimal Trello single-board export SHAPE — enough for the sniffer; full
 *  board semantics belong to the converter unit's own tests. */
export function makeTrelloBoard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "trello-board-1",
    name: "Trello Board",
    lists: [],
    cards: [],
    ...overrides,
  };
}

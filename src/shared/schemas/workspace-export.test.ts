import { describe, expect, it } from "vitest";

import { DATE_RANGE_ERROR } from "./task";
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  type ExportedProject,
  type ExportedTask,
  type ExportedUser,
  exportTaskSchema,
  MAX_IMPORT_FILE_BYTES,
  type WorkspaceExport,
  workspaceExportSchema,
} from "./workspace-export";
import {
  type ImportDocument,
  importDocumentSchema,
  type ImportPreview,
  importPreviewSchema,
  importResponseSchema,
  type ImportResult,
  importResultSchema,
} from "./workspace-import";

/**
 * Contract tests for the canonical workspace export/import format.
 *
 * Four later units (export endpoint, import executor, Trello converter,
 * frontend Data tab) build against these schemas, and the format is the
 * product's "your data is never held hostage" promise — so these tests pin
 * the behaviors that MUST NOT drift silently:
 *
 * 1. The envelope literals (`format`, `formatVersion`) gate parsing, so a
 *    foreign or future-version file fails fast with a named mismatch.
 * 2. Secrets are structurally unrepresentable: webhook `secret` and
 *    invitation `token` keys make the document REJECT (strictObject), not
 *    silently strip — a parse-the-response contract test on the export
 *    endpoint therefore catches any handler bug that leaks a raw DB row.
 * 3. The start/due range invariant is enforced at import validation with
 *    the same single-sourced messages as the create/update schemas —
 *    import is not a back door around app invariants.
 * 4. Timestamps are ISO-with-zone strings, never DB epoch integers — the
 *    endpoints convert; the format stays storage-independent.
 */

// ---------------------------------------------------------------------------
// Fixture builders — functions (not shared constants) so each test mutates a
// fresh object and cannot leak state into its neighbors.
// ---------------------------------------------------------------------------

function makeUsers(): ExportedUser[] {
  return [
    { ref: "user-1", email: "owner@example.com", name: "Olive Owner" },
    { ref: "user-2", email: "member@example.com", name: "Mel Member" },
  ];
}

function makeCoverUnsplash() {
  return {
    id: "abc123",
    rawUrl: "https://images.unsplash.com/photo-1?ixid=raw",
    url: "https://images.unsplash.com/photo-1?w=1080",
    thumbUrl: "https://images.unsplash.com/photo-1?w=200",
    blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    color: "#262626",
    description: "Mountains at dawn",
    width: 4000,
    height: 3000,
    photoUrl: "https://unsplash.com/photos/abc123",
    downloadLocation: "https://api.unsplash.com/photos/abc123/download",
    user: {
      name: "Pat Photographer",
      username: "patphoto",
      profileUrl: "https://unsplash.com/@patphoto",
    },
  };
}

/**
 * A task exercising EVERY field of the export contract — including the
 * calendar-ics additions (`startDate` range, `sourceUid`) whose absence
 * from the original format sketch is exactly the drift this fixture exists
 * to catch.
 */
function makeMaximalTask(): ExportedTask {
  return {
    id: "task-max",
    taskGroupId: "group-1",
    title: "Fully loaded task",
    description: "Exercises every exportable field",
    assigneeRef: "user-2",
    priority: "high",
    completed: true,
    completedAt: "2026-03-05T12:00:00.000Z",
    completedByRef: "user-1",
    startDate: "2026-03-01T00:00:00.000Z",
    dueDate: "2026-03-05T00:00:00.000Z",
    cost: 12_500,
    icon: "rocket",
    coverImage: {
      key: "task-cover/user-1/11111111-2222-3333-4444-555555555555.png",
      url: "/api/uploads/task-cover/user-1/11111111-2222-3333-4444-555555555555.png",
      position: 40,
    },
    coverUnsplash: makeCoverUnsplash(),
    recurrenceRule: {
      frequency: "weekly",
      interval: 2,
      daysOfWeek: [1, 3],
      endDate: "2026-12-31",
    },
    recurrenceParentId: "task-min",
    recurrenceSeriesId: "series-1",
    sourceUid: "20260301T000000Z-evt@calendar.example.com",
    position: "a1",
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-03-05T12:00:00.000Z",
    labelIds: ["label-1", "label-2"],
    subtasks: [
      {
        title: "First subtask",
        completed: true,
        position: "a0",
        createdAt: "2026-01-15T10:05:00.000Z",
      },
      {
        title: "Second subtask",
        completed: false,
        position: "a1",
        createdAt: "2026-01-15T10:06:00.000Z",
      },
    ],
    comments: [
      {
        body: "Looks good to me",
        authorRef: "user-2",
        createdAt: "2026-01-16T09:00:00.000Z",
        updatedAt: "2026-01-16T09:30:00.000Z",
      },
      {
        // Deleted author: comment.authorId is onDelete set-null in the DB,
        // so a null authorRef must be representable.
        body: "Comment from a deleted user",
        authorRef: null,
        createdAt: "2026-01-17T09:00:00.000Z",
        updatedAt: "2026-01-17T09:00:00.000Z",
      },
    ],
    attachments: [
      {
        filename: "spec.pdf",
        mimeType: "application/pdf",
        size: 482_133,
        key: "attachment/user-1/66666666-7777-8888-9999-000000000000.pdf",
        url: "/api/uploads/attachment/user-1/66666666-7777-8888-9999-000000000000.pdf",
      },
    ],
    activity: [
      {
        actorRef: "user-1",
        action: "created",
        field: null,
        oldValue: null,
        newValue: null,
        createdAt: "2026-01-15T10:00:00.000Z",
      },
      {
        actorRef: null, // actor deleted since — set-null column
        action: "updated",
        field: "priority",
        oldValue: "none",
        newValue: "high",
        createdAt: "2026-01-20T08:00:00.000Z",
      },
    ],
  };
}

/** A task with every nullable null and every array empty (and the
 *  optional `activity` key absent — it only appears with includeActivity). */
function makeMinimalTask(): ExportedTask {
  return {
    id: "task-min",
    taskGroupId: "group-2",
    title: "Bare minimum task",
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
    position: "a0",
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
    labelIds: [],
    subtasks: [],
    comments: [],
    attachments: [],
  };
}

function makeProject(): ExportedProject {
  return {
    id: "project-1",
    name: "Roadmap",
    description: "Quarterly product roadmap",
    status: "active",
    icon: "map",
    coverImage: {
      key: "project-cover/user-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
      url: "/api/uploads/project-cover/user-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
      position: null,
    },
    coverUnsplash: makeCoverUnsplash(),
    theme: "ocean",
    budget: 500_000,
    autoAssignCreator: true,
    position: "a0",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-03-05T12:00:00.000Z",
    members: [
      { userRef: "user-1", role: "admin" },
      { userRef: "user-2", role: "member" },
    ],
    taskGroups: [
      {
        id: "group-1",
        name: "In Progress",
        color: "#3b82f6",
        isCompletionGroup: false,
        position: "a0",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "group-2",
        name: "Done",
        color: null,
        isCompletionGroup: true,
        position: "a1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    labels: [
      {
        id: "label-1",
        name: "bug",
        color: "#ef4444",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "label-2",
        name: "design",
        color: "#8b5cf6",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    tasks: [makeMaximalTask(), makeMinimalTask()],
  };
}

function makeWebhook(): WorkspaceExport["webhooks"][number] {
  return {
    name: "Deploy notifier",
    url: "https://hooks.example.com/cadence",
    events: ["task.created", "task.completed"],
    active: true,
    projectId: "project-1",
  };
}

function makeInvitation(): WorkspaceExport["invitations"][number] {
  return {
    email: "invited@example.com",
    role: "member",
    status: "pending",
  };
}

function makeFixture(): WorkspaceExport {
  return {
    format: "cadence.workspace",
    formatVersion: 1,
    exportedAt: "2026-06-12T08:30:00.000Z",
    exportedBy: "owner@example.com",
    workspace: {
      name: "Acme Inc",
      slug: "acme-inc",
      description: "Everything Acme builds",
      theme: "noir",
    },
    users: makeUsers(),
    members: [
      { userRef: "user-1", role: "owner", joinedAt: "2025-11-01T00:00:00.000Z" },
      { userRef: "user-2", role: "member", joinedAt: "2025-12-01T00:00:00.000Z" },
    ],
    teams: [
      {
        name: "Platform",
        description: "Infra and tooling",
        members: [
          { userRef: "user-1", role: "lead" },
          { userRef: "user-2", role: "member" },
        ],
      },
      { name: "Design", description: null, members: [] },
    ],
    webhooks: [makeWebhook(), { ...makeWebhook(), name: "Workspace audit", projectId: null }],
    invitations: [makeInvitation()],
    projects: [makeProject()],
  };
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

describe("workspaceExportSchema envelope", () => {
  it("parses a complete fixture exercising every field", () => {
    const result = workspaceExportSchema.safeParse(makeFixture());
    expect(result.success).toBe(true);
  });

  it("is a pure validator: parse output deep-equals the input (no transforms or defaults)", () => {
    // The same document must survive validate → serialize → validate
    // byte-identically; a transform or default hidden in the schema would
    // make export and import disagree about file contents.
    const fixture = makeFixture();
    expect(workspaceExportSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a wrong format literal (foreign file fails the FIRST check, by name)", () => {
    expect(
      workspaceExportSchema.safeParse({ ...makeFixture(), format: "trello.board" }).success,
    ).toBe(false);
    expect(
      workspaceExportSchema.safeParse({ ...makeFixture(), format: "" }).success,
    ).toBe(false);
  });

  it("rejects a wrong or string-typed formatVersion", () => {
    expect(
      workspaceExportSchema.safeParse({ ...makeFixture(), formatVersion: 2 }).success,
    ).toBe(false);
    // "1" (string) must not coerce — version comparison is exact.
    expect(
      workspaceExportSchema.safeParse({ ...makeFixture(), formatVersion: "1" }).success,
    ).toBe(false);
  });

  it("pins the format constants the spec documents", () => {
    expect(EXPORT_FORMAT).toBe("cadence.workspace");
    expect(EXPORT_FORMAT_VERSION).toBe(1);
    expect(MAX_IMPORT_FILE_BYTES).toBe(20 * 1024 * 1024);
  });

  it("requires exportedBy to be an email (the portable user key, not a ref)", () => {
    expect(
      workspaceExportSchema.safeParse({ ...makeFixture(), exportedBy: "user-1" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Secrets are structurally unrepresentable
// ---------------------------------------------------------------------------

describe("secret exclusion (strictObject)", () => {
  it("rejects a webhook entry carrying a secret key — never strips it silently", () => {
    // strictObject (reject) over plain object (strip) is deliberate: the
    // export endpoint's contract test parses its response against this
    // schema, so a handler bug that spreads a raw webhook DB row into the
    // envelope becomes a loud test failure instead of being masked by
    // silent stripping — and an imported file claiming to carry secrets is
    // malformed per the spec, not quietly laundered.
    const result = workspaceExportSchema.safeParse({
      ...makeFixture(),
      webhooks: [{ ...makeWebhook(), secret: "whsec_supersecret" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("webhooks"))).toBe(true);
    }
  });

  it("rejects an invitation entry carrying a token key", () => {
    const result = workspaceExportSchema.safeParse({
      ...makeFixture(),
      invitations: [{ ...makeInvitation(), token: "inv_abcdef123456" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("invitations"))).toBe(true);
    }
  });

  it("rejects operational webhook fields too (consecutiveFailures)", () => {
    expect(
      workspaceExportSchema.safeParse({
        ...makeFixture(),
        webhooks: [{ ...makeWebhook(), consecutiveFailures: 3 }],
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task contract
// ---------------------------------------------------------------------------

describe("exportTaskSchema", () => {
  it("parses the maximal and minimal tasks standalone", () => {
    expect(exportTaskSchema.safeParse(makeMaximalTask()).success).toBe(true);
    expect(exportTaskSchema.safeParse(makeMinimalTask()).success).toBe(true);
  });

  it("accepts a start date with no due date (start-only task round-trips)", () => {
    // startDate and dueDate are independently optional: a task that begins on
    // a day with no deadline is a valid, representable state, so an export
    // carrying one must re-import cleanly. The schema only constrains ordering
    // (start ≤ due) when BOTH dates are present — see the next test.
    const result = exportTaskSchema.safeParse({
      ...makeMinimalTask(),
      startDate: "2026-03-01T00:00:00.000Z",
      dueDate: null,
    });
    expect(result.success).toBe(true);
  });

  it("enforces start ≤ due with the single-sourced message", () => {
    const result = exportTaskSchema.safeParse({
      ...makeMinimalTask(),
      startDate: "2026-03-06T00:00:00.000Z",
      dueDate: "2026-03-05T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain(
        DATE_RANGE_ERROR.startAfterDue,
      );
    }
  });

  it("accepts start === due (single-day range) and start < due", () => {
    expect(
      exportTaskSchema.safeParse({
        ...makeMinimalTask(),
        startDate: "2026-03-05T00:00:00.000Z",
        dueDate: "2026-03-05T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      exportTaskSchema.safeParse({
        ...makeMinimalTask(),
        startDate: "2026-03-01T00:00:00.000Z",
        dueDate: "2026-03-05T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("surfaces the range violation when nested inside the full envelope", () => {
    // An inverted range (start after due) is the one cross-field violation
    // that survives — a start-only task is now valid, so it can't stand in for
    // "invalid" here. This pins that a nested task-level refinement failure
    // still fails the whole envelope rather than being swallowed.
    const fixture = makeFixture();
    const project = makeProject();
    project.tasks = [
      { ...makeMinimalTask(), startDate: "2026-03-06T00:00:00.000Z", dueDate: "2026-03-05T00:00:00.000Z" },
    ];
    fixture.projects = [project];
    expect(workspaceExportSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects priorities outside the shared TASK_PRIORITIES enum", () => {
    expect(
      exportTaskSchema.safeParse({ ...makeMinimalTask(), priority: "critical" }).success,
    ).toBe(false);
  });

  it("rejects an empty-string sourceUid (null is the absent value)", () => {
    expect(
      exportTaskSchema.safeParse({ ...makeMinimalTask(), sourceUid: "" }).success,
    ).toBe(false);
  });

  it("rejects negative cost (cents are non-negative, mirroring create/update)", () => {
    expect(exportTaskSchema.safeParse({ ...makeMinimalTask(), cost: -1 }).success).toBe(false);
  });

  // Regression: a real export of a workspace failed to re-import with
  //   `projects[i].tasks[j].coverUnsplash.rawUrl: expected string, received undefined`
  // because the export schema reused the STRICT apply-endpoint Unsplash schema,
  // which requires `rawUrl`. But `rawUrl` was added to the payload after the
  // `cover_unsplash` column already existed, so covers picked before that
  // migration are stored — and therefore exported — without it. The export
  // schema now uses the lenient stored variant so legacy rows round-trip.
  // Without the fix this whole feature is unusable for any account that ever
  // set an Unsplash cover before `rawUrl` shipped.
  it("accepts a legacy coverUnsplash that predates rawUrl (round-trips on import)", () => {
    const { rawUrl, ...legacyCover } = makeCoverUnsplash();
    // Guard against fixture drift: the omission below only simulates a legacy
    // row if the full fixture actually carried a rawUrl to omit.
    expect(rawUrl).toEqual(expect.any(String));
    const result = exportTaskSchema.safeParse({
      ...makeMinimalTask(),
      coverUnsplash: legacyCover,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.coverUnsplash?.rawUrl).toBeUndefined();
      // The other prebaked URLs the runtime falls back to must still be present.
      expect(result.data.coverUnsplash?.url).toBe(legacyCover.url);
    }
  });

  it("still rejects a coverUnsplash missing a non-legacy field (only rawUrl is optional)", () => {
    const { url, ...brokenCover } = makeCoverUnsplash();
    // Same fixture-drift guard: `url` must exist for its omission to mean anything.
    expect(url).toEqual(expect.any(String));
    expect(
      exportTaskSchema.safeParse({ ...makeMinimalTask(), coverUnsplash: brokenCover })
        .success,
    ).toBe(false);
  });

  it("still rejects a coverUnsplash whose rawUrl is present but not a URL", () => {
    expect(
      exportTaskSchema.safeParse({
        ...makeMinimalTask(),
        coverUnsplash: { ...makeCoverUnsplash(), rawUrl: "not-a-url" },
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Timestamp convention
// ---------------------------------------------------------------------------

describe("ISO timestamp convention", () => {
  it("rejects DB epoch integers — the endpoints must convert, the format never leaks storage", () => {
    expect(
      exportTaskSchema.safeParse({ ...makeMinimalTask(), createdAt: 1_736_935_200_000 }).success,
    ).toBe(false);
  });

  it("rejects bare YYYY-MM-DD dates and zone-less datetimes (ambiguous instants)", () => {
    expect(
      exportTaskSchema.safeParse({ ...makeMinimalTask(), createdAt: "2026-01-10" }).success,
    ).toBe(false);
    expect(
      exportTaskSchema.safeParse({ ...makeMinimalTask(), createdAt: "2026-01-10T00:00:00" })
        .success,
    ).toBe(false);
  });

  it("accepts an explicit timezone offset (hand-repaired or third-party files)", () => {
    expect(
      exportTaskSchema.safeParse({ ...makeMinimalTask(), createdAt: "2026-01-10T05:30:00+05:30" })
        .success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Import contracts
// ---------------------------------------------------------------------------

describe("importDocumentSchema / ImportDocument", () => {
  it("parses the projects subtree + users directory of a valid export", () => {
    const fixture = makeFixture();
    const result = importDocumentSchema.safeParse({
      users: fixture.users,
      projects: fixture.projects,
    });
    expect(result.success).toBe(true);
  });

  it("type-level smoke test: a valid subtree assigns to ImportDocument and round-trips parse", () => {
    // Compile-time half: this assignment fails to typecheck if the
    // ImportDocument type ever drifts from the export subtree the
    // executor and Trello converter both build against.
    const doc: ImportDocument = {
      users: makeUsers(),
      projects: [makeProject()],
    };
    const parsed = importDocumentSchema.parse(doc);
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0]?.tasks).toHaveLength(2);
    expect(parsed.users.map((u) => u.email)).toContain("owner@example.com");
  });

  it("rejects a document whose tasks violate the export task contract", () => {
    const project = makeProject();
    project.tasks = [{ ...makeMinimalTask(), title: "" }];
    expect(
      importDocumentSchema.safeParse({ users: makeUsers(), projects: [project] }).success,
    ).toBe(false);
  });
});

describe("import preview/result schemas", () => {
  const counts = {
    projects: 1,
    taskGroups: 2,
    tasks: 2,
    labels: 2,
    subtasks: 2,
    comments: 2,
  };
  const skipped = {
    webhooks: 2,
    teams: 2,
    invitations: 1,
    attachments: 1,
    activity: 2,
    closedItems: 0,
  };

  function makePreview(): ImportPreview {
    return {
      dryRun: true,
      sourceFormat: "cadence",
      counts,
      unmatchedUsers: [{ email: "gone@example.com", name: "Gone Person", taskCount: 3 }],
      skipped,
      warnings: ["Project name 'Roadmap' already exists in this workspace"],
    };
  }

  function makeResult(): ImportResult {
    return {
      dryRun: false,
      sourceFormat: "trello",
      counts,
      unmatchedUsers: [],
      skipped,
      warnings: [],
      failedProjects: [{ name: "Roadmap", error: "UNIQUE constraint failed" }],
    };
  }

  it("parses a preview and a result payload", () => {
    expect(importPreviewSchema.safeParse(makePreview()).success).toBe(true);
    expect(importResultSchema.safeParse(makeResult()).success).toBe(true);
  });

  it("discriminates the union on dryRun (the flag the client sent)", () => {
    const preview = importResponseSchema.parse(makePreview());
    const result = importResponseSchema.parse(makeResult());
    expect(preview.dryRun).toBe(true);
    expect(result.dryRun).toBe(false);
    // Type-level narrowing check: failedProjects only exists on results.
    if (result.dryRun === false) {
      expect(result.failedProjects).toHaveLength(1);
    }
  });

  it("requires failedProjects on results but not previews", () => {
    const full = makeResult();
    const resultWithout = {
      dryRun: full.dryRun,
      sourceFormat: full.sourceFormat,
      counts: full.counts,
      unmatchedUsers: full.unmatchedUsers,
      skipped: full.skipped,
      warnings: full.warnings,
    };
    expect(importResultSchema.safeParse(resultWithout).success).toBe(false);
    expect(importPreviewSchema.safeParse(makePreview()).success).toBe(true);
  });

  it("rejects negative and fractional counts (accumulator-bug guard)", () => {
    expect(
      importPreviewSchema.safeParse({
        ...makePreview(),
        counts: { ...counts, tasks: -1 },
      }).success,
    ).toBe(false);
    expect(
      importPreviewSchema.safeParse({
        ...makePreview(),
        counts: { ...counts, tasks: 1.5 },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown sourceFormat values (UI badge depends on the sniffed kind)", () => {
    expect(
      importPreviewSchema.safeParse({ ...makePreview(), sourceFormat: "asana" }).success,
    ).toBe(false);
  });
});

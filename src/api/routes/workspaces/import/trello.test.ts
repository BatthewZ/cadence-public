import { describe, expect, it } from "vitest";

import { LABEL_COLORS } from "@/shared/schemas/label";
import { importDocumentSchema } from "@/shared/schemas/workspace-import";

import {
  convertTrelloBoard,
  looksLikeTrelloBoard,
  trelloBoardSchema,
  trelloColorToLabelColor,
  trelloToImportDocument,
} from "./trello";

/**
 * Tests for the Trello → Cadence converter.
 *
 * Why these tests matter (they are contract tests, not unit trivia):
 *
 * - The converter's output feeds the SAME import executor as a Cadence
 *   export file. If `importDocumentSchema.parse()` ever fails on converted
 *   output, every Trello import 400s — so the round-trip-through-the-schema
 *   test is THE test; everything else explains failures it would catch.
 *
 * - The input fixtures deliberately model the real Trello single-board
 *   export shape, including the noise keys (`prefs`, `badges`, `limits`,
 *   `descData`, plugin data, …) Trello actually emits. The lenient-schema
 *   guarantee — "hundreds of irrelevant keys never break a real file" —
 *   is only proven if the fixtures carry that noise.
 *
 * - The field caps (title ≤ 200, desc ≤ 5000, label ≤ 30) are the app's own
 *   validation limits embedded in the import contract; the truncation tests
 *   pin that import can never smuggle in values the UI couldn't create.
 *
 * - Trello exports contain NO email addresses, so the `users` directory
 *   must be empty and all authorship degrades to body prefixes — pinned
 *   here so a future "improvement" doesn't start guessing identities by
 *   display name and mis-assigning tasks.
 */

/** Deterministic fallback clock for ids that don't carry ObjectId time. */
const NOW = new Date("2026-06-12T00:00:00.000Z");
const NOW_ISO = NOW.toISOString();

function convert(raw: unknown) {
  return trelloToImportDocument(trelloBoardSchema.parse(raw), { now: NOW });
}

/** Smallest convertible board, with override escape hatch for edge cases. */
function minimalBoard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "5f1a2b3c4d5e6f7a8b9c0d1e",
    name: "Minimal board",
    desc: "",
    lists: [],
    cards: [],
    ...overrides,
  };
}

/**
 * A realistic full Trello single-board export. Array order of `lists`
 * intentionally disagrees with `pos` (Doing before To Do) to prove ordering
 * follows `pos`. Includes archived list + archived card + card on the
 * archived list + orphan card, multi- and single-checklist cards, comment
 * and non-comment actions, and label edge cases.
 */
function fullBoard(): Record<string, unknown> {
  return {
    id: "5f1a2b3c4d5e6f7a8b9c0d1e",
    name: "Product Roadmap",
    desc: "Q3 planning board",
    descData: { emoji: {} },
    closed: false,
    idOrganization: "5e9f8e7d6c5b4a3928171615",
    url: "https://trello.com/b/AbCd1234/product-roadmap",
    shortUrl: "https://trello.com/b/AbCd1234",
    prefs: {
      permissionLevel: "private",
      background: "blue",
      backgroundImage: null,
      calendarFeedEnabled: false,
      cardCovers: true,
    },
    labelNames: {
      green: "Ready",
      yellow: "",
      orange: "",
      red: "",
      purple: "",
      blue: "",
      sky: "",
      lime: "",
      pink: "",
      black: "",
    },
    dateLastActivity: "2026-05-20T10:00:00.000Z",
    memberships: [
      { id: "ms1", idMember: "member-ada", memberType: "admin", unconfirmed: false },
    ],
    members: [
      { id: "member-ada", fullName: "Ada Lovelace", username: "ada", initials: "AL" },
      { id: "member-grace", fullName: "Grace Hopper", username: "ghopper", initials: "GH" },
    ],
    powerUps: [],
    pluginData: [{ id: "pd1", idPlugin: "5e6f7a8b", scope: "board", value: "{}" }],
    limits: { attachments: { perCard: { status: "ok", disableAt: 1000, warnAt: 800 } } },
    labels: [
      { id: "label-ready", idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e", name: "Ready", color: "green" },
      { id: "label-unnamed-sky", idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e", name: "", color: "sky" },
      {
        id: "label-long",
        idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e",
        name: "A very long label name that goes past thirty characters",
        color: "purple",
      },
      { id: "label-nocolor", idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e", name: "Chore", color: null },
    ],
    lists: [
      {
        id: "list-doing",
        name: "Doing",
        closed: false,
        pos: 200.5,
        idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e",
        subscribed: false,
        softLimit: null,
      },
      {
        id: "list-todo",
        name: "To Do",
        closed: false,
        pos: 100,
        idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e",
        subscribed: false,
        softLimit: null,
      },
      {
        id: "list-archive",
        name: "Old stuff",
        closed: true,
        pos: 50,
        idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e",
        subscribed: false,
        softLimit: null,
      },
    ],
    cards: [
      {
        id: "card-ship",
        name: "Ship the beta",
        desc: "",
        closed: false,
        idList: "list-todo",
        due: "2026-06-20T09:30:00.000Z",
        dueComplete: true,
        idLabels: ["label-ready"],
        pos: 1,
        dateLastActivity: "2026-05-19T08:00:00.000Z",
        badges: { votes: 0, attachments: 2, comments: 0, checkItems: 0, checkItemsChecked: 0 },
        idMembers: ["member-ada"],
        idChecklists: [],
        shortLink: "aB1cD2eF",
        cover: { idAttachment: null, color: null, size: "normal", brightness: "dark" },
        labels: [{ id: "label-ready", name: "Ready", color: "green" }],
      },
      {
        id: "card-spec",
        name: "Write the spec",
        desc: "Long-form **markdown** description",
        closed: false,
        idList: "list-todo",
        due: null,
        dueComplete: false,
        idLabels: ["label-unnamed-sky", "label-ready", "label-ghost", "label-ready"],
        pos: 2,
        dateLastActivity: "2026-05-18T08:00:00.000Z",
        badges: { votes: 1, attachments: 0, comments: 2, checkItems: 3, checkItemsChecked: 1 },
        idMembers: [],
        idChecklists: ["chk-design", "chk-qa"],
        shortLink: "gH3iJ4kL",
      },
      {
        id: "card-fix",
        name: "Fix login redirect",
        desc: "",
        closed: false,
        idList: "list-doing",
        due: "2026-06-01T12:00:00.000Z",
        dueComplete: false,
        idLabels: [],
        pos: 1,
        dateLastActivity: null,
        idChecklists: ["chk-steps"],
        shortLink: "mN5oP6qR",
      },
      {
        id: "card-archived",
        name: "Archived card",
        desc: "",
        closed: true,
        idList: "list-todo",
        due: null,
        dueComplete: false,
        idLabels: [],
        pos: 3,
      },
      {
        id: "card-in-archived-list",
        name: "Lives on the archived list",
        desc: "",
        closed: false,
        idList: "list-archive",
        due: null,
        dueComplete: false,
        idLabels: [],
        pos: 1,
      },
      {
        id: "card-orphan",
        name: "Orphan card",
        desc: "",
        closed: false,
        idList: "list-ghost",
        due: null,
        dueComplete: false,
        idLabels: [],
        pos: 1,
      },
    ],
    checklists: [
      {
        id: "chk-qa",
        idCard: "card-spec",
        idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e",
        name: "QA",
        pos: 2,
        checkItems: [
          {
            id: "ci-smoke",
            idChecklist: "chk-qa",
            name: "Smoke test",
            state: "incomplete",
            pos: 1,
            due: null,
            idMember: null,
          },
        ],
      },
      {
        id: "chk-design",
        idCard: "card-spec",
        idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e",
        name: "Design",
        pos: 1,
        checkItems: [
          { id: "ci-review", idChecklist: "chk-design", name: "Review", state: "incomplete", pos: 2 },
          { id: "ci-wireframe", idChecklist: "chk-design", name: "Wireframe", state: "complete", pos: 1 },
        ],
      },
      {
        id: "chk-steps",
        idCard: "card-fix",
        idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e",
        name: "Checklist",
        pos: 1,
        checkItems: [
          { id: "ci-repro", idChecklist: "chk-steps", name: "Repro the bug", state: "complete", pos: 1 },
          { id: "ci-patch", idChecklist: "chk-steps", name: "Patch", state: "incomplete", pos: 2 },
        ],
      },
      {
        id: "chk-on-archived",
        idCard: "card-archived",
        idBoard: "5f1a2b3c4d5e6f7a8b9c0d1e",
        name: "Ghost",
        pos: 1,
        checkItems: [{ id: "ci-ghost", name: "Never imported", state: "incomplete", pos: 1 }],
      },
    ],
    actions: [
      {
        id: "act-1",
        type: "commentCard",
        date: "2026-05-02T08:00:00.000Z",
        memberCreator: { id: "member-ada", fullName: "Ada Lovelace", username: "ada", avatarHash: "x" },
        data: {
          text: "Looks good to me",
          card: { id: "card-spec", name: "Write the spec", shortLink: "gH3iJ4kL" },
          board: { id: "5f1a2b3c4d5e6f7a8b9c0d1e", name: "Product Roadmap" },
          list: { id: "list-todo", name: "To Do" },
        },
      },
      {
        id: "act-2",
        type: "commentCard",
        date: "2026-05-01T08:00:00.000Z",
        memberCreator: { id: "member-grace", fullName: "Grace Hopper", username: "ghopper" },
        data: { text: "Needs more detail", card: { id: "card-spec" } },
      },
      {
        id: "act-3",
        type: "updateCard",
        date: "2026-05-03T08:00:00.000Z",
        memberCreator: { id: "member-ada", fullName: "Ada Lovelace" },
        data: { card: { id: "card-spec" }, old: { pos: 1 }, listAfter: { id: "list-doing" } },
      },
      {
        id: "act-4",
        type: "commentCard",
        date: "2026-05-04T08:00:00.000Z",
        memberCreator: { id: "member-ada", fullName: "Ada Lovelace" },
        data: { text: "Comment on an archived card", card: { id: "card-archived" } },
      },
    ],
  };
}

function assertAscendingUniquePositions(positions: string[]) {
  expect(new Set(positions).size).toBe(positions.length);
  expect([...positions].sort()).toEqual(positions);
}

describe("trelloBoardSchema", () => {
  it("parses a real-shaped export despite the noise keys Trello emits", () => {
    expect(() => trelloBoardSchema.parse(fullBoard())).not.toThrow();
  });

  it("defaults missing optional containers (checklists/actions/labels/members)", () => {
    const board = trelloBoardSchema.parse(minimalBoard());
    expect(board.checklists).toEqual([]);
    expect(board.actions).toEqual([]);
    expect(board.labels).toEqual([]);
    expect(board.members).toEqual([]);
  });

  it("degrades a malformed pos to undefined instead of failing the file", () => {
    const board = trelloBoardSchema.parse(
      minimalBoard({ lists: [{ id: "list-a", name: "A", closed: false, pos: "top" }] }),
    );
    expect(board.lists[0].pos).toBeUndefined();
  });
});

describe("looksLikeTrelloBoard", () => {
  it("matches a Trello board export", () => {
    expect(looksLikeTrelloBoard(fullBoard())).toBe(true);
  });

  it("rejects a Cadence export (format discriminator present)", () => {
    expect(
      looksLikeTrelloBoard({ format: "cadence.workspace", lists: [], cards: [] }),
    ).toBe(false);
  });

  it("rejects non-board values", () => {
    expect(looksLikeTrelloBoard(null)).toBe(false);
    expect(looksLikeTrelloBoard([])).toBe(false);
    expect(looksLikeTrelloBoard({ name: "nope" })).toBe(false);
  });
});

describe("trelloColorToLabelColor", () => {
  it.each([
    ["green", "#22c55e"],
    ["yellow", "#eab308"],
    ["orange", "#f97316"],
    ["red", "#ef4444"],
    ["purple", "#8b5cf6"],
    ["blue", "#3b82f6"],
    ["sky", "#06b6d4"],
    ["lime", "#22c55e"],
    ["pink", "#ec4899"],
    ["black", "#6b7280"],
  ] as const)("maps Trello %s into the palette (%s)", (trelloColor, expected) => {
    const mapped = trelloColorToLabelColor(trelloColor);
    expect(mapped).toBe(expected);
    expect(LABEL_COLORS).toContain(mapped);
  });

  it("maps null and unknown colors to the gray fallback", () => {
    expect(trelloColorToLabelColor(null)).toBe("#6b7280");
    expect(trelloColorToLabelColor(undefined)).toBe("#6b7280");
    expect(trelloColorToLabelColor("magenta")).toBe("#6b7280");
  });

  it("maps _dark/_light shade variants to their base hue", () => {
    expect(trelloColorToLabelColor("green_dark")).toBe("#22c55e");
    expect(trelloColorToLabelColor("sky_light")).toBe("#06b6d4");
  });
});

describe("trelloToImportDocument — full board", () => {
  it("produces a document that passes importDocumentSchema.parse (THE contract test)", () => {
    const { document } = convert(fullBoard());
    expect(() => importDocumentSchema.parse(document)).not.toThrow();
  });

  it("maps the board to exactly one project with sensible defaults", () => {
    const { document } = convert(fullBoard());
    expect(document.projects).toHaveLength(1);
    const project = document.projects[0];
    expect(project.id).toBe("5f1a2b3c4d5e6f7a8b9c0d1e");
    expect(project.name).toBe("Product Roadmap");
    expect(project.description).toBe("Q3 planning board");
    expect(project.status).toBe("active");
    expect(project.icon).toBeNull();
    expect(project.theme).toBeNull();
    expect(project.budget).toBeNull();
    expect(project.coverImage).toBeNull();
    expect(project.coverUnsplash).toBeNull();
    expect(project.autoAssignCreator).toBe(false);
    // Executor computes a fresh position in the target workspace.
    expect(project.position).toBeNull();
    expect(project.members).toEqual([]);
  });

  it("leaves the users directory empty — Trello exports carry no emails by design", () => {
    const { document } = convert(fullBoard());
    expect(document.users).toEqual([]);
  });

  it("orders groups by pos (not array order) and skips archived lists", () => {
    const { document } = convert(fullBoard());
    const groups = document.projects[0].taskGroups;
    // Array order was [Doing, To Do, Old stuff]; pos order is To Do < Doing.
    expect(groups.map((g) => g.name)).toEqual(["To Do", "Doing"]);
    expect(groups.every((g) => !g.isCompletionGroup)).toBe(true);
    assertAscendingUniquePositions(groups.map((g) => g.position));
  });

  it("counts archived lists, archived cards, cards on archived lists, and orphans as closed items", () => {
    const { closedItemsSkipped, document } = convert(fullBoard());
    // 1 archived list + 1 archived card + 1 card on the archived list
    // + 1 card whose list is missing from the export.
    expect(closedItemsSkipped).toBe(4);
    const taskIds = document.projects[0].tasks.map((t) => t.id);
    expect(taskIds).not.toContain("card-archived");
    expect(taskIds).not.toContain("card-in-archived-list");
    expect(taskIds).not.toContain("card-orphan");
  });

  it("warns about cards whose list is missing from the export", () => {
    const { warnings } = convert(fullBoard());
    expect(warnings.some((w) => w.includes("referenced a list that is not in the export"))).toBe(
      true,
    );
  });

  it("orders tasks by card pos within each group with fresh fractional positions", () => {
    const { document } = convert(fullBoard());
    const project = document.projects[0];
    const todoTasks = project.tasks.filter((t) => t.taskGroupId === "list-todo");
    expect(todoTasks.map((t) => t.title)).toEqual(["Ship the beta", "Write the spec"]);
    assertAscendingUniquePositions(todoTasks.map((t) => t.position));
    const doingTasks = project.tasks.filter((t) => t.taskGroupId === "list-doing");
    expect(doingTasks.map((t) => t.title)).toEqual(["Fix login redirect"]);
  });

  it("maps due → dueDate and dueComplete → completed; missing due stays null", () => {
    const { document } = convert(fullBoard());
    const tasks = document.projects[0].tasks;
    const ship = tasks.find((t) => t.id === "card-ship")!;
    expect(ship.dueDate).toBe("2026-06-20T09:30:00.000Z");
    expect(ship.completed).toBe(true);
    // Trello records THAT a due date was met, never when.
    expect(ship.completedAt).toBeNull();
    expect(ship.completedByRef).toBeNull();
    const spec = tasks.find((t) => t.id === "card-spec")!;
    expect(spec.dueDate).toBeNull();
    expect(spec.completed).toBe(false);
  });

  it("keeps tasks unassigned with no priority/cost/recurrence — Trello has no equivalents", () => {
    const { document } = convert(fullBoard());
    for (const task of document.projects[0].tasks) {
      expect(task.assigneeRef).toBeNull();
      expect(task.priority).toBe("none");
      expect(task.cost).toBeNull();
      expect(task.startDate).toBeNull();
      expect(task.recurrenceRule).toBeNull();
      expect(task.sourceUid).toBeNull();
      expect(task.attachments).toEqual([]);
    }
  });

  it("maps labels into the palette and names unnamed labels after their color", () => {
    const { document } = convert(fullBoard());
    const labels = document.projects[0].labels;
    const byId = new Map(labels.map((l) => [l.id, l]));
    expect(byId.get("label-ready")).toMatchObject({ name: "Ready", color: "#22c55e" });
    expect(byId.get("label-unnamed-sky")).toMatchObject({ name: "sky", color: "#06b6d4" });
    expect(byId.get("label-nocolor")).toMatchObject({ name: "Chore", color: "#6b7280" });
    for (const label of labels) {
      expect(LABEL_COLORS).toContain(label.color);
    }
  });

  it("truncates label names longer than 30 characters", () => {
    const { document, warnings } = convert(fullBoard());
    const long = document.projects[0].labels.find((l) => l.id === "label-long")!;
    expect(long.name).toHaveLength(30);
    expect(long.name).toBe("A very long label name that go");
    expect(warnings.some((w) => w.includes("label name"))).toBe(true);
  });

  it("filters labelIds to emitted labels and dedupes repeats", () => {
    const { document } = convert(fullBoard());
    const spec = document.projects[0].tasks.find((t) => t.id === "card-spec")!;
    expect(spec.labelIds).toEqual(["label-unnamed-sky", "label-ready"]);
  });

  it("prefixes subtasks with the checklist name when a card has multiple checklists", () => {
    const { document } = convert(fullBoard());
    const spec = document.projects[0].tasks.find((t) => t.id === "card-spec")!;
    // Checklists ordered by pos (Design before QA), items by pos within each.
    expect(spec.subtasks.map((s) => s.title)).toEqual([
      "Design: Wireframe",
      "Design: Review",
      "QA: Smoke test",
    ]);
    expect(spec.subtasks.map((s) => s.completed)).toEqual([true, false, false]);
    assertAscendingUniquePositions(spec.subtasks.map((s) => s.position));
  });

  it("adds no prefix for a single checklist (its name is usually Trello's default)", () => {
    const { document } = convert(fullBoard());
    const fix = document.projects[0].tasks.find((t) => t.id === "card-fix")!;
    expect(fix.subtasks.map((s) => s.title)).toEqual(["Repro the bug", "Patch"]);
    expect(fix.subtasks.map((s) => s.completed)).toEqual([true, false]);
  });

  it("maps commentCard actions to comments with author prefix, authorRef null, oldest first", () => {
    const { document } = convert(fullBoard());
    const spec = document.projects[0].tasks.find((t) => t.id === "card-spec")!;
    expect(spec.comments).toEqual([
      {
        body: "**Grace Hopper:** Needs more detail",
        authorRef: null,
        createdAt: "2026-05-01T08:00:00.000Z",
        updatedAt: "2026-05-01T08:00:00.000Z",
      },
      {
        body: "**Ada Lovelace:** Looks good to me",
        authorRef: null,
        createdAt: "2026-05-02T08:00:00.000Z",
        updatedAt: "2026-05-02T08:00:00.000Z",
      },
    ]);
  });

  it("ignores non-comment actions and comments on skipped cards", () => {
    const { document } = convert(fullBoard());
    const allComments = document.projects[0].tasks.flatMap((t) => t.comments);
    expect(allComments).toHaveLength(2);
    expect(allComments.some((c) => c.body.includes("archived"))).toBe(false);
  });

  it("resolves every intra-file FK to an emitted entity", () => {
    const { document } = convert(fullBoard());
    const project = document.projects[0];
    const groupIds = new Set(project.taskGroups.map((g) => g.id));
    const labelIds = new Set(project.labels.map((l) => l.id));
    for (const task of project.tasks) {
      expect(groupIds.has(task.taskGroupId)).toBe(true);
      for (const id of task.labelIds) {
        expect(labelIds.has(id)).toBe(true);
      }
    }
  });

  it("reports the unmatched-members situation as a warning", () => {
    const { warnings } = convert(fullBoard());
    expect(
      warnings.some(
        (w) => w.includes("2 members") && w.includes("do not include email addresses"),
      ),
    ).toBe(true);
  });
});

describe("trelloToImportDocument — caps as contract pressure", () => {
  it("truncates card titles over 200 characters and still passes the contract", () => {
    const result = convert(
      minimalBoard({
        lists: [{ id: "list-a", name: "A", closed: false, pos: 1 }],
        cards: [
          {
            id: "card-long",
            name: "T".repeat(250),
            desc: "",
            closed: false,
            idList: "list-a",
            pos: 1,
          },
        ],
      }),
    );
    const task = result.document.projects[0].tasks[0];
    expect(task.title).toHaveLength(200);
    expect(result.warnings.some((w) => w.includes("card title"))).toBe(true);
    expect(() => importDocumentSchema.parse(result.document)).not.toThrow();
  });

  it("truncates card descriptions over 5000 characters", () => {
    const result = convert(
      minimalBoard({
        lists: [{ id: "list-a", name: "A", closed: false, pos: 1 }],
        cards: [
          {
            id: "card-desc",
            name: "Card",
            desc: "d".repeat(6000),
            closed: false,
            idList: "list-a",
            pos: 1,
          },
        ],
      }),
    );
    expect(result.document.projects[0].tasks[0].description).toHaveLength(5000);
    expect(result.warnings.some((w) => w.includes("card description"))).toBe(true);
    expect(() => importDocumentSchema.parse(result.document)).not.toThrow();
  });

  it("truncates board name to 100 and board description to 1000", () => {
    const result = convert(
      minimalBoard({ name: "B".repeat(120), desc: "d".repeat(1500) }),
    );
    const project = result.document.projects[0];
    expect(project.name).toHaveLength(100);
    expect(project.description).toHaveLength(1000);
    expect(() => importDocumentSchema.parse(result.document)).not.toThrow();
  });

  it("prefix-truncates long checklist item titles to 200", () => {
    const result = convert(
      minimalBoard({
        lists: [{ id: "list-a", name: "A", closed: false, pos: 1 }],
        cards: [
          { id: "card-a", name: "Card", desc: "", closed: false, idList: "list-a", pos: 1 },
        ],
        checklists: [
          {
            id: "chk-1",
            idCard: "card-a",
            name: "Steps",
            pos: 1,
            checkItems: [{ id: "ci-1", name: "x".repeat(300), state: "incomplete", pos: 1 }],
          },
          {
            id: "chk-2",
            idCard: "card-a",
            name: "More",
            pos: 2,
            checkItems: [{ id: "ci-2", name: "ok", state: "incomplete", pos: 1 }],
          },
        ],
      }),
    );
    const subtasks = result.document.projects[0].tasks[0].subtasks;
    expect(subtasks[0].title).toHaveLength(200);
    expect(subtasks[0].title.startsWith("Steps: ")).toBe(true);
    expect(result.warnings.some((w) => w.includes("checklist item"))).toBe(true);
    expect(() => importDocumentSchema.parse(result.document)).not.toThrow();
  });

  it("renames duplicate label names so the document stays insertable (UNIQUE projectId+name)", () => {
    const result = convert(
      minimalBoard({
        labels: [
          { id: "label-1", name: "Bug", color: "red" },
          { id: "label-2", name: "Bug", color: "orange" },
          { id: "label-3", name: "", color: "green" },
          { id: "label-4", name: "", color: "green" },
        ],
      }),
    );
    const names = result.document.projects[0].labels.map((l) => l.name);
    expect(names).toEqual(["Bug", "Bug (2)", "green", "green (2)"]);
    expect(result.warnings.some((w) => w.includes("duplicate label"))).toBe(true);
    expect(() => importDocumentSchema.parse(result.document)).not.toThrow();
  });
});

describe("trelloToImportDocument — resilience and provenance", () => {
  it("converts a board with no checklists/actions/labels/members keys at all", () => {
    const result = convert(
      minimalBoard({
        lists: [{ id: "list-a", name: "A", closed: false, pos: 1 }],
        cards: [
          { id: "card-a", name: "Card", desc: "", closed: false, idList: "list-a", pos: 1 },
        ],
      }),
    );
    expect(() => importDocumentSchema.parse(result.document)).not.toThrow();
    const task = result.document.projects[0].tasks[0];
    expect(task.subtasks).toEqual([]);
    expect(task.comments).toEqual([]);
    expect(task.labelIds).toEqual([]);
    expect(result.closedItemsSkipped).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("converts an empty board to an empty (but contract-valid) project", () => {
    const result = convert(minimalBoard());
    expect(() => importDocumentSchema.parse(result.document)).not.toThrow();
    const project = result.document.projects[0];
    expect(project.taskGroups).toEqual([]);
    expect(project.tasks).toEqual([]);
    expect(project.labels).toEqual([]);
  });

  it("synthesizes a project id and name when the board omits them", () => {
    const result = convert({ lists: [], cards: [] });
    const project = result.document.projects[0];
    expect(project.id).toBe("trello-board");
    expect(project.name).toBe("Imported Trello board");
    expect(() => importDocumentSchema.parse(result.document)).not.toThrow();
  });

  it("recovers real creation timestamps from Mongo ObjectId ids", () => {
    // 0x60000000 seconds = 1610612736 = 2021-01-14T08:25:36Z.
    const result = convert(
      minimalBoard({
        lists: [{ id: "list-plain", name: "A", closed: false, pos: 1 }],
        cards: [
          {
            id: "60000000aaaabbbbcccc0001",
            name: "Old card",
            desc: "",
            closed: false,
            idList: "list-plain",
            pos: 1,
          },
        ],
      }),
    );
    const task = result.document.projects[0].tasks[0];
    expect(task.createdAt).toBe("2021-01-14T08:25:36.000Z");
    // Non-ObjectId ids fall back to the injected clock.
    expect(result.document.projects[0].taskGroups[0].createdAt).toBe(NOW_ISO);
  });

  it("clears unparseable due dates with a warning instead of failing", () => {
    const result = convert(
      minimalBoard({
        lists: [{ id: "list-a", name: "A", closed: false, pos: 1 }],
        cards: [
          {
            id: "card-baddue",
            name: "Card",
            desc: "",
            closed: false,
            idList: "list-a",
            due: "not-a-date",
            dueComplete: false,
            pos: 1,
          },
        ],
      }),
    );
    expect(result.document.projects[0].tasks[0].dueDate).toBeNull();
    expect(result.warnings.some((w) => w.includes("due date"))).toBe(true);
    expect(() => importDocumentSchema.parse(result.document)).not.toThrow();
  });

  it("orders lists with unusable pos after positioned ones, in array order", () => {
    const result = convert(
      minimalBoard({
        lists: [
          { id: "list-z", name: "No pos B", closed: false, pos: "top" },
          { id: "list-b", name: "Second", closed: false, pos: 2 },
          { id: "list-a", name: "First", closed: false, pos: 1 },
          { id: "list-y", name: "No pos C", closed: false },
        ],
      }),
    );
    expect(result.document.projects[0].taskGroups.map((g) => g.name)).toEqual([
      "First",
      "Second",
      "No pos B",
      "No pos C",
    ]);
  });

  it("convertTrelloBoard composes parse + convert into the pipeline's {doc, skipped, warnings} shape", () => {
    const result = convertTrelloBoard(fullBoard());
    expect(() => importDocumentSchema.parse(result.doc)).not.toThrow();
    expect(result.skipped).toEqual({ closedItems: 4 });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("convertTrelloBoard throws a ZodError for values that are not a Trello board", () => {
    expect(() => convertTrelloBoard({ id: 5, lists: "nope", cards: [] })).toThrow();
  });

  it("falls back to username, then a placeholder, for comment authors without a full name", () => {
    const result = convert(
      minimalBoard({
        lists: [{ id: "list-a", name: "A", closed: false, pos: 1 }],
        cards: [
          { id: "card-a", name: "Card", desc: "", closed: false, idList: "list-a", pos: 1 },
        ],
        actions: [
          {
            id: "act-u",
            type: "commentCard",
            date: "2026-05-01T08:00:00.000Z",
            memberCreator: { id: "m-kay", username: "kay" },
            data: { text: "via username", card: { id: "card-a" } },
          },
          {
            id: "act-n",
            type: "commentCard",
            date: "2026-05-02T08:00:00.000Z",
            data: { text: "no member at all", card: { id: "card-a" } },
          },
        ],
      }),
    );
    const bodies = result.document.projects[0].tasks[0].comments.map((c) => c.body);
    expect(bodies).toEqual(["**kay:** via username", "**Unknown member:** no member at all"]);
  });
});

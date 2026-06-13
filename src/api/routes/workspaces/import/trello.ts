import { z } from "zod";

// Relative imports, NOT the `@/` alias: wrangler's esbuild worker bundle does
// not resolve the alias (only tsc/vitest/vite do), so an alias import here
// crashes `wrangler dev`/deploy while every CI gate stays green. All worker
// code uses relative paths for this reason.
import { generateNKeysBetween } from "../../../../shared/lib/fractional-index";
import { LABEL_COLORS } from "../../../../shared/schemas/label";
import type {
  ExportedComment,
  ExportedLabel,
  ExportedProject,
  ExportedSubtask,
  ExportedTask,
  ExportedTaskGroup,
} from "../../../../shared/schemas/workspace-export";
import type { ImportDocument } from "../../../../shared/schemas/workspace-import";

/**
 * Trello → Cadence converter.
 *
 * Accepts Trello's single-board JSON export (Board menu → Print/Export →
 * JSON) and converts it into the canonical {@link ImportDocument} — the SAME
 * shape `parse.ts` produces for Cadence files. That single shared contract
 * is the whole point: the import executor has exactly one input format, so
 * Trello imports get preview / commit / per-project rollback for free and
 * there is exactly one write path to audit.
 *
 * Design rules this module pins, and WHY:
 *
 * - **The board schema is deliberately LENIENT** ({@link trelloBoardSchema}):
 *   real Trello exports carry hundreds of keys we never read (`prefs`,
 *   `badges`, `descData`, `limits`, power-up plugin data, …) and Trello adds
 *   more without notice. Every container is a `z.looseObject` declaring ONLY
 *   the fields the converter uses; strictness here would reject real files
 *   for irrelevant reasons. Leniency is bounded, though — entity `id`s on
 *   lists/cards/labels stay required because without them the document's
 *   intra-file FK joins (`taskGroupId`, `labelIds`) cannot hold.
 *
 * - **The OUTPUT is strict by design.** The produced document must pass
 *   `importDocumentSchema.parse()`, which embeds the app's field caps
 *   (title ≤ 200, description ≤ 5000, label name ≤ 30, …). Import is not a
 *   back door around app validation, so Trello data is truncated/normalized
 *   to FIT the contract, with each truncation tallied into `warnings` so
 *   the user is told instead of discovering clipped data later.
 *
 * - **The `users` directory is EMPTY by design.** Trello exports contain
 *   member names/usernames but NO email addresses, and email is the only
 *   portable user-matching key the import pipeline accepts (matching by
 *   display name would mis-assign tasks). Every Trello member is therefore
 *   unmatched: tasks import unassigned, comment authorship is preserved as
 *   a human-readable body prefix (`**Name:** …`) with `authorRef: null`,
 *   and a warning reports the member count.
 *
 * - **Closed (archived) lists and cards are skipped, not imported,** and
 *   counted into {@link TrelloConversionResult.closedItemsSkipped} so the
 *   handler can feed `ImportSkipped.closedItems` honestly. Archived Trello
 *   data is hidden-by-default on Trello itself; silently resurrecting it
 *   into an active Cadence project would be surprising.
 *
 * - **Real timestamps are recovered from Trello ids.** Trello ids are Mongo
 *   ObjectIds whose first 4 bytes are the creation time in epoch seconds —
 *   so `createdAt` carries honest provenance instead of a fabricated
 *   conversion-time value wherever the id permits it.
 */

/* -------------------------------------------------------------------------
 * Lenient input schemas
 * ---------------------------------------------------------------------- */

/**
 * `pos` is Trello's ordering float. `.catch(undefined)` because a missing
 * or malformed position must degrade to array order, never fail the import
 * of an otherwise-fine board.
 */
const trelloPos = z.number().optional().catch(undefined);

export const trelloLabelSchema = z.looseObject({
  /** Required: `cards[].idLabels` joins on it. */
  id: z.string().min(1),
  name: z.string().default(""),
  /** Trello color token (`green`, `sky`, `green_dark`, …) or null. */
  color: z.string().nullable().default(null),
});

export const trelloListSchema = z.looseObject({
  /** Required: `cards[].idList` joins on it. */
  id: z.string().min(1),
  name: z.string().default(""),
  /** `closed === true` means archived. */
  closed: z.boolean().default(false),
  pos: trelloPos,
});

export const trelloCardSchema = z.looseObject({
  /** Required: checklists/comments join on it, and it becomes the task's
   *  source id. */
  id: z.string().min(1),
  name: z.string().default(""),
  desc: z.string().default(""),
  closed: z.boolean().default(false),
  /** Optional so a structurally damaged card is skipped (and counted),
   *  not fatal to the whole board. */
  idList: z.string().optional(),
  due: z.string().nullable().optional().catch(null),
  dueComplete: z.boolean().default(false).catch(false),
  idLabels: z.array(z.string()).default([]).catch([]),
  pos: trelloPos,
  dateLastActivity: z.string().nullable().optional().catch(null),
});

export const trelloCheckItemSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().default(""),
  /** `"complete"` | `"incomplete"` in real exports; kept as a plain string
   *  so an unknown state degrades to "not completed" instead of failing. */
  state: z.string().default("incomplete"),
  pos: trelloPos,
});

export const trelloChecklistSchema = z.looseObject({
  id: z.string().optional(),
  idCard: z.string().optional(),
  name: z.string().default(""),
  pos: trelloPos,
  checkItems: z.array(trelloCheckItemSchema).default([]),
});

/**
 * Actions cover dozens of types with type-specific `data` payloads; every
 * field is optional so ALL of them parse and the converter filters for
 * `type === "commentCard"` itself.
 */
export const trelloActionSchema = z.looseObject({
  id: z.string().optional(),
  type: z.string().default(""),
  date: z.string().optional(),
  data: z
    .looseObject({
      text: z.string().optional(),
      card: z.looseObject({ id: z.string().optional() }).optional(),
    })
    .optional(),
  memberCreator: z
    .looseObject({
      fullName: z.string().optional(),
      username: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export const trelloMemberSchema = z.looseObject({
  id: z.string().optional(),
  fullName: z.string().optional(),
  username: z.string().optional(),
});

/**
 * A Trello single-board export. Only the consumed fields are declared; the
 * loose containers pass the export's hundreds of irrelevant keys through
 * unvalidated (see module JSDoc for why leniency is the requirement here).
 * Containers default to `[]` because partial exports (or older Trello
 * versions) may omit `checklists`/`actions`/`members` entirely.
 */
export const trelloBoardSchema = z.looseObject({
  id: z.string().min(1).optional(),
  name: z.string().default(""),
  desc: z.string().nullable().default(null),
  dateLastActivity: z.string().nullable().optional().catch(null),
  labels: z.array(trelloLabelSchema).default([]),
  lists: z.array(trelloListSchema).default([]),
  cards: z.array(trelloCardSchema).default([]),
  checklists: z.array(trelloChecklistSchema).default([]),
  actions: z.array(trelloActionSchema).default([]),
  members: z.array(trelloMemberSchema).default([]),
});

export type TrelloBoard = z.infer<typeof trelloBoardSchema>;

/* -------------------------------------------------------------------------
 * Format sniffing
 * ---------------------------------------------------------------------- */

/**
 * Cheap structural sniff for `parse.ts` format dispatch: a Trello board has
 * `lists` + `cards` arrays and — unlike a Cadence export — no `format`
 * discriminator. The sniff only decides WHICH schema to try; actual
 * validation belongs to {@link trelloBoardSchema}.
 */
export function looksLikeTrelloBoard(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.format === "string") return false;
  return Array.isArray(candidate.lists) && Array.isArray(candidate.cards);
}

/* -------------------------------------------------------------------------
 * Color mapping
 * ---------------------------------------------------------------------- */

/**
 * Trello color token → nearest `LABEL_COLORS` hex.
 *
 * Rationale per entry (Trello's rendered hue → palette hue):
 * - `green/yellow/orange/red/blue/pink` → the identically named palette hue.
 * - `purple` → violet `#8b5cf6` — the palette's purple.
 * - `sky` (Trello `#00c2e0`, a cyan-leaning light blue) → cyan `#06b6d4`,
 *   which is visibly closer than the palette blue `#3b82f6`.
 * - `lime` (Trello `#51e898`, a yellow-green) → green `#22c55e`. This
 *   collides with `green` — accepted, because the mapping promises the
 *   NEAREST palette color, not a unique one.
 * - `black` → gray `#6b7280` — the palette has no black; cool gray is the
 *   nearest neutral (stone `#78716c` is warm-tinted).
 * - `null`/unknown → gray, matching how Trello renders colorless labels as
 *   neutral chips.
 *
 * Newer Trello exports emit `_dark`/`_light` shade variants (`green_dark`);
 * those map to their base hue — the palette has one slot per hue.
 */
const TRELLO_COLOR_TO_LABEL_COLOR: Record<string, (typeof LABEL_COLORS)[number]> = {
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
  purple: "#8b5cf6",
  blue: "#3b82f6",
  sky: "#06b6d4",
  lime: "#22c55e",
  pink: "#ec4899",
  black: "#6b7280",
};

/** Fallback for colorless/unknown Trello labels — see mapping rationale. */
const TRELLO_FALLBACK_LABEL_COLOR: (typeof LABEL_COLORS)[number] = "#6b7280";

/** Maps a Trello color token (or null) into the `LABEL_COLORS` palette. */
export function trelloColorToLabelColor(
  color: string | null | undefined,
): (typeof LABEL_COLORS)[number] {
  if (!color) return TRELLO_FALLBACK_LABEL_COLOR;
  const base = color.toLowerCase().replace(/_(dark|light)$/, "");
  return TRELLO_COLOR_TO_LABEL_COLOR[base] ?? TRELLO_FALLBACK_LABEL_COLOR;
}

/**
 * Display name for an UNNAMED label: the Trello color token (underscores
 * humanized: `green_dark` → "green dark") so the user recognizes the label
 * they had, rather than our internal palette bucket. Colorless unnamed
 * labels are named "gray" — the same neutral bucket their chip lands in.
 */
function labelNameFromColor(color: string | null | undefined): string {
  if (!color) return "gray";
  return color.toLowerCase().replace(/_/g, " ");
}

/* -------------------------------------------------------------------------
 * Conversion result
 * ---------------------------------------------------------------------- */

/**
 * What `trelloToImportDocument` hands the import handler (WX7):
 *
 * - `document` — executor-ready, `importDocumentSchema`-valid.
 * - `closedItemsSkipped` — single count feeding `ImportSkipped.closedItems`:
 *   archived lists + archived cards + cards whose list was archived or
 *   missing from the file.
 * - `warnings` — human-readable strings appended onto the preview/result
 *   `warnings` array (truncation tallies, unmatched-member note, skipped
 *   orphan cards, deduplicated label names).
 */
export interface TrelloConversionResult {
  document: ImportDocument;
  closedItemsSkipped: number;
  warnings: string[];
}

export interface TrelloConvertOptions {
  /**
   * Fallback timestamp for entities whose Trello id is not a Mongo
   * ObjectId (and for `updatedAt` when no activity date exists).
   * Injectable so tests are deterministic; defaults to the wall clock.
   */
  now?: Date;
}

/* -------------------------------------------------------------------------
 * Field caps (from the Wave-1 export contract — single source of truth is
 * `workspace-export.ts`; these constants only name the numbers locally).
 * ---------------------------------------------------------------------- */

const PROJECT_NAME_MAX = 100;
const PROJECT_DESCRIPTION_MAX = 1000;
const GROUP_NAME_MAX = 100;
const TASK_TITLE_MAX = 200;
const TASK_DESCRIPTION_MAX = 5000;
const LABEL_NAME_MAX = 30;
const SUBTASK_TITLE_MAX = 200;
const COMMENT_BODY_MAX = 5000;

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

/** Mongo ObjectId: 24 hex chars; first 8 = creation time, epoch seconds. */
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

/**
 * Recovers the creation timestamp embedded in a Trello (Mongo ObjectId) id.
 * Honest provenance: the import keeps the card/list/label's REAL creation
 * date instead of stamping everything with the conversion time. Falls back
 * to `fallbackIso` for ids that aren't ObjectIds (test fixtures, future
 * Trello id formats).
 */
function trelloIdToIsoDate(id: string | undefined, fallbackIso: string): string {
  if (!id || !OBJECT_ID_RE.test(id)) return fallbackIso;
  const seconds = Number.parseInt(id.slice(0, 8), 16);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallbackIso;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Normalizes any parseable date string to UTC ISO-8601 (`…Z`), which always
 * satisfies the contract's `z.iso.datetime({ offset: true })`. Unparseable
 * input → null, never a throw: a bad date must cost one field, not the file.
 */
function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Cap-fitting truncation. The caps are the app's own create/update limits
 * embedded in the import contract — import must not smuggle in values a
 * hand-created entity couldn't have (contract pressure by design), so the
 * converter trims to fit and reports via `onTruncate` tallies. Also drops a
 * trailing lone high surrogate so a cut can't produce a malformed pair.
 */
function truncate(value: string, max: number, onTruncate?: () => void): string {
  if (value.length <= max) return value;
  onTruncate?.();
  let cut = value.slice(0, max);
  const lastCode = cut.charCodeAt(cut.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/**
 * Stable ascending sort by Trello's `pos` float. Items without a usable
 * `pos` sort last, in original array order — order degradation, never
 * failure. The explicit index tiebreak makes determinism independent of
 * engine sort stability.
 */
function byPos<T extends { pos?: number | undefined }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const posA = a.item.pos ?? Number.POSITIVE_INFINITY;
      const posB = b.item.pos ?? Number.POSITIVE_INFINITY;
      if (posA !== posB) return posA - posB;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function truncationWarning(count: number, what: string, cap: number): string {
  const verb = count === 1 ? "was" : "were";
  return `${count} ${plural(count, what)} exceeded ${cap} characters and ${verb} truncated.`;
}

/** Per-category truncation tallies — aggregated into bounded warnings
 *  (one line per category) instead of one warning per clipped value, which
 *  on a large board would bury the report in noise. */
interface TruncationCounts {
  groupNames: number;
  cardTitles: number;
  cardDescriptions: number;
  labelNames: number;
  subtaskTitles: number;
  commentBodies: number;
}

/* -------------------------------------------------------------------------
 * Converter
 * ---------------------------------------------------------------------- */

/**
 * Converts a parsed Trello board into the canonical import document.
 *
 * Mapping (plan design decision 6):
 * - board → ONE project (`name`, `desc` → description; `status: "active"`,
 *   no theme/budget/icon — Trello has no equivalents).
 * - open `lists` → task groups ordered by `pos`, with FRESH fractional-index
 *   positions (`generateNKeysBetween`) — Trello floats are not valid
 *   fractional-index keys. `isCompletionGroup` is never inferred: guessing
 *   from a list name like "Done" would silently change task semantics.
 * - open `cards` → tasks (`due` → dueDate, `dueComplete` → completed;
 *   `completedAt` stays null — Trello does not record WHEN).
 * - `labels` → labels via {@link trelloColorToLabelColor}; duplicate names
 *   get a ` (2)` suffix because the target DB enforces UNIQUE
 *   (projectId, name) — the converter must emit an insertable document.
 * - `checklists` → subtasks; with MULTIPLE checklists on a card the item
 *   titles are prefixed `"<checklist>: <item>"` to preserve grouping; a
 *   single checklist adds no prefix (its name is almost always Trello's
 *   default "Checklist" — prefixing would be pure noise).
 * - `commentCard` actions → comments with the author folded into the body
 *   (`**Name:** text`) and `authorRef: null` — see module JSDoc on the
 *   no-emails design.
 * - Source ids are the Trello ids themselves (already unique strings), so
 *   intra-file FK joins (`taskGroupId`, `labelIds`) hold by construction.
 */
export function trelloToImportDocument(
  board: TrelloBoard,
  options: TrelloConvertOptions = {},
): TrelloConversionResult {
  const nowIso = (options.now ?? new Date()).toISOString();
  const warnings: string[] = [];
  const truncated: TruncationCounts = {
    groupNames: 0,
    cardTitles: 0,
    cardDescriptions: 0,
    labelNames: 0,
    subtaskTitles: 0,
    commentBodies: 0,
  };

  let closedItemsSkipped = 0;
  let cardsMissingList = 0;
  let invalidDueDates = 0;
  let duplicateLabelNames = 0;
  let boardNameTruncated = false;
  let boardDescriptionTruncated = false;

  /* ---- Lists → task groups (open only, ordered by pos) ---- */

  const listById = new Map(board.lists.map((list) => [list.id, list]));
  const openLists = byPos(board.lists.filter((list) => !list.closed));
  closedItemsSkipped += board.lists.length - openLists.length;

  const groupPositions = generateNKeysBetween(null, null, openLists.length);
  const taskGroups: ExportedTaskGroup[] = openLists.map((list, index) => {
    const createdAt = trelloIdToIsoDate(list.id, nowIso);
    return {
      id: list.id,
      name: truncate(list.name.trim() || "Untitled list", GROUP_NAME_MAX, () => {
        truncated.groupNames += 1;
      }),
      color: null,
      isCompletionGroup: false,
      position: groupPositions[index],
      createdAt,
      updatedAt: createdAt,
    };
  });

  /* ---- Labels (dedup names for the DB's UNIQUE (projectId, name)) ---- */

  const usedLabelNames = new Set<string>();
  const labels: ExportedLabel[] = board.labels.map((label) => {
    const baseName = truncate(
      label.name.trim() || labelNameFromColor(label.color),
      LABEL_NAME_MAX,
      () => {
        truncated.labelNames += 1;
      },
    );
    let name = baseName;
    if (usedLabelNames.has(name)) {
      duplicateLabelNames += 1;
      for (let n = 2; usedLabelNames.has(name); n += 1) {
        const suffix = ` (${n})`;
        name = truncate(baseName, LABEL_NAME_MAX - suffix.length) + suffix;
      }
    }
    usedLabelNames.add(name);
    return {
      id: label.id,
      name,
      color: trelloColorToLabelColor(label.color),
      createdAt: trelloIdToIsoDate(label.id, nowIso),
    };
  });
  const labelIdSet = new Set(labels.map((label) => label.id));

  /* ---- Checklists grouped by card ---- */

  const checklistsByCard = new Map<string, TrelloBoard["checklists"]>();
  for (const checklist of board.checklists) {
    if (!checklist.idCard) continue;
    const bucket = checklistsByCard.get(checklist.idCard);
    if (bucket) bucket.push(checklist);
    else checklistsByCard.set(checklist.idCard, [checklist]);
  }

  /* ---- commentCard actions grouped by card ---- */

  const commentsByCard = new Map<string, ExportedComment[]>();
  for (const action of board.actions) {
    if (action.type !== "commentCard") continue;
    const cardId = action.data?.card?.id;
    const text = action.data?.text?.trim();
    if (!cardId || !text) continue;
    const author =
      action.memberCreator?.fullName?.trim() ||
      action.memberCreator?.username?.trim() ||
      "Unknown member";
    const when = normalizeIsoDate(action.date) ?? nowIso;
    const comment: ExportedComment = {
      body: truncate(`**${author}:** ${text}`, COMMENT_BODY_MAX, () => {
        truncated.commentBodies += 1;
      }),
      authorRef: null,
      createdAt: when,
      updatedAt: when,
    };
    const bucket = commentsByCard.get(cardId);
    if (bucket) bucket.push(comment);
    else commentsByCard.set(cardId, [comment]);
  }
  // Trello emits actions newest-first; comments read top-down, so emit
  // chronologically (ISO-8601 UTC strings sort lexicographically).
  for (const bucket of commentsByCard.values()) {
    bucket.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  /* ---- Cards → tasks (open cards on open lists only) ---- */

  const cardsByList = new Map<string, TrelloBoard["cards"]>();
  for (const card of board.cards) {
    if (card.closed) {
      closedItemsSkipped += 1;
      continue;
    }
    const list = card.idList ? listById.get(card.idList) : undefined;
    if (!list) {
      // Orphaned: its list isn't in the export at all. Skipped + counted +
      // warned — silently dropping a card would be quiet data loss.
      closedItemsSkipped += 1;
      cardsMissingList += 1;
      continue;
    }
    if (list.closed) {
      closedItemsSkipped += 1;
      continue;
    }
    const bucket = cardsByList.get(list.id);
    if (bucket) bucket.push(card);
    else cardsByList.set(list.id, [card]);
  }

  const tasks: ExportedTask[] = [];
  for (const list of openLists) {
    const cards = byPos(cardsByList.get(list.id) ?? []);
    const positions = generateNKeysBetween(null, null, cards.length);
    cards.forEach((card, index) => {
      let dueDate: string | null = null;
      if (card.due) {
        dueDate = normalizeIsoDate(card.due);
        if (dueDate === null) invalidDueDates += 1;
      }
      const description = card.desc?.trim()
        ? truncate(card.desc.trim(), TASK_DESCRIPTION_MAX, () => {
            truncated.cardDescriptions += 1;
          })
        : null;
      const createdAt = trelloIdToIsoDate(card.id, nowIso);
      const labelIds = [...new Set(card.idLabels)].filter((id) => labelIdSet.has(id));
      tasks.push({
        id: card.id,
        taskGroupId: list.id,
        title: truncate(card.name.trim() || "Untitled card", TASK_TITLE_MAX, () => {
          truncated.cardTitles += 1;
        }),
        description,
        assigneeRef: null,
        priority: "none",
        completed: card.dueComplete,
        // Trello records THAT a due date was met, never when — fabricating
        // a completion timestamp would be false provenance.
        completedAt: null,
        completedByRef: null,
        startDate: null,
        dueDate,
        cost: null,
        icon: null,
        coverImage: null,
        coverUnsplash: null,
        recurrenceRule: null,
        recurrenceParentId: null,
        recurrenceSeriesId: null,
        // sourceUid is ICS provenance (backs a dedupe index) — repurposing
        // it for Trello ids would pollute that semantic, so it stays null.
        sourceUid: null,
        position: positions[index],
        createdAt,
        updatedAt: normalizeIsoDate(card.dateLastActivity) ?? createdAt,
        labelIds,
        subtasks: buildSubtasks(checklistsByCard.get(card.id) ?? [], nowIso, truncated),
        comments: commentsByCard.get(card.id) ?? [],
        attachments: [],
      });
    });
  }

  /* ---- Board → project ---- */

  const boardId = board.id ?? "trello-board";
  const projectCreatedAt = trelloIdToIsoDate(board.id, nowIso);
  const boardDesc = board.desc?.trim() ?? "";
  const project: ExportedProject = {
    id: boardId,
    name: truncate(board.name.trim() || "Imported Trello board", PROJECT_NAME_MAX, () => {
      boardNameTruncated = true;
    }),
    description: boardDesc
      ? truncate(boardDesc, PROJECT_DESCRIPTION_MAX, () => {
          boardDescriptionTruncated = true;
        })
      : null,
    status: "active",
    icon: null,
    coverImage: null,
    coverUnsplash: null,
    theme: null,
    budget: null,
    autoAssignCreator: false,
    // The executor computes a fresh position in the target workspace.
    position: null,
    createdAt: projectCreatedAt,
    updatedAt: normalizeIsoDate(board.dateLastActivity) ?? projectCreatedAt,
    members: [],
    taskGroups,
    labels,
    tasks,
  };

  /* ---- Warnings (aggregated, bounded) ---- */

  if (boardNameTruncated) {
    warnings.push(truncationWarning(1, "board name", PROJECT_NAME_MAX));
  }
  if (boardDescriptionTruncated) {
    warnings.push(truncationWarning(1, "board description", PROJECT_DESCRIPTION_MAX));
  }
  if (truncated.groupNames > 0) {
    warnings.push(truncationWarning(truncated.groupNames, "list name", GROUP_NAME_MAX));
  }
  if (truncated.cardTitles > 0) {
    warnings.push(truncationWarning(truncated.cardTitles, "card title", TASK_TITLE_MAX));
  }
  if (truncated.cardDescriptions > 0) {
    warnings.push(
      truncationWarning(truncated.cardDescriptions, "card description", TASK_DESCRIPTION_MAX),
    );
  }
  if (truncated.labelNames > 0) {
    warnings.push(truncationWarning(truncated.labelNames, "label name", LABEL_NAME_MAX));
  }
  if (truncated.subtaskTitles > 0) {
    warnings.push(truncationWarning(truncated.subtaskTitles, "checklist item", SUBTASK_TITLE_MAX));
  }
  if (truncated.commentBodies > 0) {
    warnings.push(truncationWarning(truncated.commentBodies, "comment", COMMENT_BODY_MAX));
  }
  if (duplicateLabelNames > 0) {
    warnings.push(
      `${duplicateLabelNames} duplicate label ${plural(duplicateLabelNames, "name")} ` +
        `renamed with a numeric suffix (label names must be unique within a project).`,
    );
  }
  if (invalidDueDates > 0) {
    warnings.push(
      `${invalidDueDates} card due ${plural(invalidDueDates, "date")} could not be parsed and ` +
        `${invalidDueDates === 1 ? "was" : "were"} cleared.`,
    );
  }
  if (cardsMissingList > 0) {
    warnings.push(
      `${cardsMissingList} ${plural(cardsMissingList, "card")} referenced a list that is not in ` +
        `the export and ${cardsMissingList === 1 ? "was" : "were"} skipped.`,
    );
  }
  if (board.members.length > 0) {
    warnings.push(
      `Board has ${board.members.length} ${plural(board.members.length, "member")}; Trello ` +
        `exports do not include email addresses, so all imported tasks are unassigned and ` +
        `comment authors are noted in the comment text.`,
    );
  }

  return {
    document: {
      // Empty by design: Trello exports carry no emails, and email is the
      // ONLY user-matching key the import pipeline accepts (see module
      // JSDoc) — so there is nothing matchable to put in the directory.
      users: [],
      projects: [project],
    },
    closedItemsSkipped,
    warnings,
  };
}

/**
 * Pipeline-ready composition: lenient board validation + conversion,
 * reshaped into the `{ doc, skipped, warnings }` structure `parse.ts`
 * expects from its injected Trello converter. Deliberately STRUCTURALLY
 * compatible with parse.ts's `TrelloConversion` rather than importing the
 * type — the two modules are built as concurrent work units and a value
 * dependency in this direction would invert the planned wiring (parse.ts
 * receives the converter via options; it is not imported by it).
 *
 * Throws `z.ZodError` when the value is not a recognizable Trello board —
 * the pipeline maps that to a user-facing validation failure.
 */
export function convertTrelloBoard(raw: unknown): {
  doc: ImportDocument;
  skipped: { closedItems: number };
  warnings: string[];
} {
  const { document, closedItemsSkipped, warnings } = trelloToImportDocument(
    trelloBoardSchema.parse(raw),
  );
  return { doc: document, skipped: { closedItems: closedItemsSkipped }, warnings };
}

/**
 * Flattens a card's checklists into the task's subtask list.
 *
 * Decision pinned by tests: with MULTIPLE checklists the item titles are
 * prefixed `"<checklist name>: <item>"` so the grouping survives the
 * flattening; a SINGLE checklist adds no prefix because its name is almost
 * always Trello's default ("Checklist") and prefixing every subtask would
 * be noise. Checklists and items each follow their Trello `pos` order, and
 * positions are fresh fractional keys in one per-task namespace (subtask
 * positions are UNIQUE per task in the target DB).
 */
function buildSubtasks(
  checklists: TrelloBoard["checklists"],
  nowIso: string,
  truncated: TruncationCounts,
): ExportedSubtask[] {
  const ordered = byPos(checklists);
  const usePrefix = ordered.length > 1;
  const entries: Array<Omit<ExportedSubtask, "position">> = [];
  for (const checklist of ordered) {
    const checklistName = checklist.name.trim();
    for (const item of byPos(checklist.checkItems)) {
      const itemName = item.name.trim() || "Untitled item";
      const title = usePrefix && checklistName ? `${checklistName}: ${itemName}` : itemName;
      entries.push({
        title: truncate(title, SUBTASK_TITLE_MAX, () => {
          truncated.subtaskTitles += 1;
        }),
        completed: item.state === "complete",
        createdAt: trelloIdToIsoDate(item.id, nowIso),
      });
    }
  }
  const positions = generateNKeysBetween(null, null, entries.length);
  return entries.map((entry, index) => ({ ...entry, position: positions[index] }));
}

/**
 * Pure view-state utilities for Saved Views.
 *
 * A saved view is a named snapshot of the project board's URL view state
 * (filters + grouping + active tab). The URL stays the runtime source of
 * truth: applying a view writes its params (plus `view=<id>`) back to the
 * URL, and a "dirty" indicator compares the CURRENT url state against the
 * active view's stored state. The main quality risk for that indicator is
 * false positives — showing "Edited" when nothing meaningful changed — so
 * every comparison in this module is normalized (set semantics for
 * comma-lists, absent == empty, key-order insensitivity) rather than a naive
 * string compare.
 *
 * Everything here is a pure function over `URLSearchParams` / plain records —
 * no React, no router — so the behavior is pinned by fast unit tests in
 * `view-state.test.ts`. The consumer (ViewSwitcher) lands in the next wave of
 * the Saved Views plan; until then, those tests are what keep this module
 * from being flagged as dead code at the gate.
 */

import {
  MULTI_VALUE_PARAM_KEYS,
  type SavedViewState,
  TASK_VIEW_PARAM_KEYS,
} from "@/shared/schemas/saved-view";

/**
 * Tabs this client can actually render. Deliberately a local list (not an
 * enum on the schema): the stored `tab` is an open string so a FUTURE client
 * can save tabs this deployment has never heard of (see
 * `savedViewStateSchema`), and only the web client decides what it can show.
 */
const KNOWN_VIEW_TABS = ["board", "list", "timeline"] as const;

export type ViewTab = (typeof KNOWN_VIEW_TABS)[number];

const KNOWN_VIEW_TAB_SET: ReadonlySet<string> = new Set(KNOWN_VIEW_TABS);

/**
 * `Set` views of the schema's const tuples so membership checks accept plain
 * `string` keys. (`readonly ["assignee", ...]`.includes() narrows its argument
 * to the tuple's literal union, which would force unsafe casts at every call
 * site that iterates user-provided keys.)
 */
const MULTI_VALUE_KEY_SET: ReadonlySet<string> = new Set(MULTI_VALUE_PARAM_KEYS);

/**
 * Membership view of the canonical keys, used by {@link viewStateToSearch} to
 * tell canonical params from unknown (future-client) ones. Hoisted to module
 * scope like the sets above so it is built once, not rebuilt on every
 * serialization call.
 */
const TASK_VIEW_PARAM_KEY_SET: ReadonlySet<string> = new Set(TASK_VIEW_PARAM_KEYS);

/**
 * Reserved by the apply mechanism itself: `viewStateToSearch` always writes
 * `view=<id>` from its argument. If a (hand-crafted or buggy) stored state
 * also contained a `view` key, serializing it verbatim would emit two `view`
 * params — and `URLSearchParams.get()` returns the FIRST match, so the stale
 * stored id would shadow the real one. The stored copy is therefore dropped.
 */
const RESERVED_SERIALIZE_KEYS: ReadonlySet<string> = new Set(["view"]);

/**
 * Snapshot the current URL view state into a {@link SavedViewState}.
 *
 * Picks ONLY the canonical {@link TASK_VIEW_PARAM_KEYS} from the URL — it is
 * a whitelist, which is why transient params can never leak into a saved
 * view: `task` (the open task-detail panel) would make a view permanently
 * reopen one specific task, and `view` (the currently-applied view id) would
 * make a view recursively point at another view. Neither is part of the
 * filter/grouping state a user means to bookmark.
 *
 * Empty-string values are omitted: `?assignee=` and a missing `assignee` are
 * the same filter state, and storing the empty form would later trip the
 * dirty indicator against a URL that simply omits the key.
 */
export function captureViewState(
  tab: string,
  searchParams: URLSearchParams,
): SavedViewState {
  const params: Record<string, string> = {};
  for (const key of TASK_VIEW_PARAM_KEYS) {
    const value = searchParams.get(key);
    if (value !== null && value !== "") {
      params[key] = value;
    }
  }
  return { tab, params };
}

/**
 * Serialize a saved view's params (plus `view=<id>`) into a URL search
 * string (no leading `?`, i.e. `URLSearchParams.toString()` form).
 *
 * Unknown stored keys are written VERBATIM — forward compatibility is the
 * point of the schema's open params record: a future client's `sort` param
 * must round-trip through today's client unchanged, so applying and
 * re-saving a view here never strips state a newer deployment depends on.
 * The only exception is the reserved `view` key itself (see
 * {@link RESERVED_SERIALIZE_KEYS}).
 *
 * Ordering is deterministic and pinned by tests so that two serializations
 * of equal states produce byte-identical strings (stable URLs, stable
 * history entries):
 *   1. canonical {@link TASK_VIEW_PARAM_KEYS}, in their declared order;
 *   2. unknown keys, sorted lexicographically;
 *   3. `view=<id>` last.
 *
 * Empty-string values are skipped, mirroring {@link captureViewState}'s
 * absent == empty normalization, so a stored `{ assignee: "" }` cannot
 * produce a `?assignee=` URL that the dirty compare would have to special-case.
 */
export function viewStateToSearch(state: SavedViewState, viewId: string): string {
  const search = new URLSearchParams();

  for (const key of TASK_VIEW_PARAM_KEYS) {
    const value = state.params[key];
    if (value !== undefined && value !== "") {
      search.set(key, value);
    }
  }

  const unknownKeys = Object.keys(state.params)
    .filter((key) => !TASK_VIEW_PARAM_KEY_SET.has(key) && !RESERVED_SERIALIZE_KEYS.has(key))
    .sort();
  for (const key of unknownKeys) {
    const value = state.params[key];
    if (value !== undefined && value !== "") {
      search.set(key, value);
    }
  }

  search.set("view", viewId);
  return search.toString();
}

/**
 * Build the URL search string for EXITING the active view — i.e. releasing
 * the board back to its default, unfiltered state (no leading `?`, in
 * `URLSearchParams.toString()` form).
 *
 * This is the inverse of {@link viewStateToSearch}: it removes the `view` id
 * AND every canonical filter/grouping key this client knows about
 * ({@link TASK_VIEW_PARAM_KEYS}), so "clear view" means "back to default" and
 * not merely "deselect the bookmark while leaving its filters applied" (the
 * latter would leave a dangling state the dirty check reads as "Edited",
 * which is exactly the confusing limbo this action exists to avoid).
 *
 * Everything else is preserved verbatim — most importantly `task` (the open
 * task-detail panel), so clearing a view never yanks a task the user is
 * reading out from under them. Unknown future-client keys are NOT stripped
 * because this client can't know they belong to the view's filter state; the
 * whitelist mirrors {@link captureViewState} for that same reason.
 */
export function clearViewSearch(searchParams: URLSearchParams): string {
  const next = new URLSearchParams(searchParams);
  next.delete("view");
  for (const key of TASK_VIEW_PARAM_KEYS) {
    next.delete(key);
  }
  return next.toString();
}

/**
 * Map a stored tab name to a tab this client can render.
 *
 * Known tabs pass through; anything else falls back to `"board"` (the
 * project's default landing tab). The fallback exists because `tab` is an
 * open string by design — a NEWER client may save `"calendar"`, and an older
 * deployment applying that view must still land somewhere sensible instead
 * of building a dead route. (Calendar itself is a future plan; it is not a
 * known tab today.)
 */
export function resolveViewTab(tab: string): ViewTab {
  return KNOWN_VIEW_TAB_SET.has(tab) ? (tab as ViewTab) : "board";
}

/**
 * Normalize one param value for comparison.
 *
 * For {@link MULTI_VALUE_PARAM_KEYS} the comma-list is treated as a SET:
 * segments are deduplicated, empty segments (from stray commas) dropped, and
 * the rest sorted — `assignee=u1,none` and `assignee=none,u1` are the same
 * filter. All other keys (single-value canonical params AND unknown keys)
 * compare verbatim: `dueDateFrom=2026-01-01` vs `2026-01-02` is a real edit,
 * and we cannot assume a future client's unknown param is order-insensitive.
 *
 * Returns `""` for absent/empty values so that "key missing" and "key
 * present but empty" normalize identically.
 */
function normalizeParamValue(key: string, value: string | undefined): string {
  if (value === undefined || value === "") return "";
  if (!MULTI_VALUE_KEY_SET.has(key)) return value;
  return [...new Set(value.split(","))]
    .filter((segment) => segment !== "")
    .sort()
    .join(",");
}

/**
 * Normalized equality between two view states — the "dirty" predicate behind
 * the "Edited" indicator (`!isViewStateEqual(currentUrlState, view.state)`).
 *
 * Normalization is the whole point: a naive `JSON.stringify` compare would
 * flag a view as edited when the user merely toggled an assignee off and on
 * (comma-list reordered), when capture produced keys in a different insertion
 * order, or when one side stores `completed: ""` where the other omits the
 * key. Each of those is a false "Edited", which trains users to ignore the
 * indicator.
 *
 * Rules, each pinned by a test:
 * - `tab` compares exactly (board vs list IS a different view).
 * - Key order never matters (records compare as maps).
 * - Absent == empty-string for every key.
 * - {@link MULTI_VALUE_PARAM_KEYS} compare as sets (order/duplicate
 *   insensitive); all other values — including single-value canonical params
 *   like `dueDateFrom` — compare verbatim.
 * - Unknown keys participate verbatim: a difference in a future client's
 *   param is still a real difference and must read as "Edited" here rather
 *   than be silently ignored.
 */
export function isViewStateEqual(a: SavedViewState, b: SavedViewState): boolean {
  if (a.tab !== b.tab) return false;

  const keys = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
  for (const key of keys) {
    const left = normalizeParamValue(key, a.params[key]);
    const right = normalizeParamValue(key, b.params[key]);
    if (left !== right) return false;
  }
  return true;
}

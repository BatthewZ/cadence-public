/**
 * Pure selection transforms for the markdown editor toolbar.
 *
 * Why pure: the editor stores markdown as a plain string (the canonical
 * end-to-end format — see swarm/plans/markdown.md §1). Toolbar actions are just
 * string rewrites plus a new caret/selection range, so they belong in a tiny,
 * fully-unit-testable module with zero React/DOM coupling. The `MarkdownEditor`
 * calls these against the live textarea's `{value, selectionStart, selectionEnd}`,
 * then applies the returned `value` and feeds `start`/`end` straight into
 * `textarea.setSelectionRange`. Every function returns a *new* `MdSelection`;
 * none mutate their input.
 *
 * Caret-math is the whole point of this module, so each function documents
 * exactly where the caret/selection lands after the edit.
 */

export interface MdSelection {
  value: string;
  start: number;
  end: number;
}

/** The inline wrapper markers supported by the toolbar. */
type InlineMarker = "**" | "_" | "`";

/**
 * Toggle an inline wrapper around the selection.
 *
 * - Non-empty selection already wrapped (markers immediately surround it, or the
 *   selection itself includes the markers) → unwrap, keeping the inner text
 *   selected.
 * - Non-empty selection not wrapped → wrap, keeping the inner text selected so a
 *   second click round-trips back to the unwrapped state.
 * - Empty selection → insert `marker + marker` and place the caret between them
 *   so the user can type the emphasised text immediately.
 */
export function wrapInline(sel: MdSelection, marker: InlineMarker): MdSelection {
  const { value, start, end } = sel;
  const len = marker.length;

  if (start === end) {
    const next = value.slice(0, start) + marker + marker + value.slice(start);
    const caret = start + len;
    return { value: next, start: caret, end: caret };
  }

  const selected = value.slice(start, end);

  // Case A: the markers sit just outside the selection, e.g. **|bold|**.
  const outerBefore = value.slice(Math.max(0, start - len), start);
  const outerAfter = value.slice(end, end + len);
  if (outerBefore === marker && outerAfter === marker) {
    const next = value.slice(0, start - len) + selected + value.slice(end + len);
    const newStart = start - len;
    return { value: next, start: newStart, end: newStart + selected.length };
  }

  // Case B: the selection itself includes the markers, e.g. |**bold**|.
  if (
    selected.length >= len * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(len, selected.length - len);
    const next = value.slice(0, start) + inner + value.slice(end);
    return { value: next, start, end: start + inner.length };
  }

  // Otherwise wrap.
  const next = value.slice(0, start) + marker + selected + marker + value.slice(end);
  const newStart = start + len;
  return { value: next, start: newStart, end: newStart + selected.length };
}

/** Inclusive `[lineStart, lineEnd)` range of the lines spanned by `[start, end]`. */
function lineSpan(value: string, start: number, end: number): { lineStart: number; lineEnd: number } {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;
  // If the selection ends exactly at a line break (end sits on a "\n"), don't
  // pull in the following line — the user only highlighted up to the newline.
  if (end > start && value[end - 1] === "\n") {
    lineEnd = end - 1;
  }
  return { lineStart, lineEnd };
}

/**
 * Rewrite the block of lines spanned by the selection, then return a selection
 * that covers the full rewritten block. Keeping the whole block selected (rather
 * than guessing an interior caret) makes successive toggles predictable and lets
 * the editor re-toggle the same lines without the user re-selecting.
 */
function transformLines(
  sel: MdSelection,
  transform: (lines: string[]) => string[],
): MdSelection {
  const { value, start, end } = sel;
  const { lineStart, lineEnd } = lineSpan(value, start, end);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const nextBlock = transform(lines).join("\n");
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
  return { value: next, start: lineStart, end: lineStart + nextBlock.length };
}

const HEADING_RE = /^(#{1,6})\s+/;

/**
 * Set the heading level on every line the selection touches. `level === 0`
 * clears any heading. Re-applying the level that a line already has clears it
 * (toggle-off), so the same toolbar button flips a heading on and off.
 */
export function toggleHeading(sel: MdSelection, level: 0 | 1 | 2 | 3 | 4 | 5 | 6): MdSelection {
  // Decide toggle-off against the first line so a multi-line selection moves as a
  // block: if the first line already matches `level`, clear all; otherwise set all.
  const { value, start, end } = sel;
  const { lineStart } = lineSpan(value, start, end);
  const firstLineEnd = value.indexOf("\n", lineStart);
  const firstLine = value.slice(lineStart, firstLineEnd === -1 ? value.length : firstLineEnd);
  const firstMatch = firstLine.match(HEADING_RE);
  const firstLevel = firstMatch ? firstMatch[1].length : 0;
  const target = level !== 0 && firstLevel === level ? 0 : level;

  return transformLines(sel, (lines) =>
    lines.map((line) => {
      const stripped = line.replace(HEADING_RE, "");
      return target === 0 ? stripped : "#".repeat(target) + " " + stripped;
    }),
  );
}

const BLOCKQUOTE_RE = /^>\s?/;

/**
 * Toggle the `> ` blockquote prefix on the selected line(s). If every non-empty
 * line in the block is already quoted, unquote; otherwise quote all lines (so a
 * partially-quoted block becomes fully quoted on first click).
 */
export function toggleBlockquote(sel: MdSelection): MdSelection {
  return transformLines(sel, (lines) => {
    const allQuoted = lines.every((line) => BLOCKQUOTE_RE.test(line));
    if (allQuoted) {
      return lines.map((line) => line.replace(BLOCKQUOTE_RE, ""));
    }
    return lines.map((line) => "> " + line.replace(BLOCKQUOTE_RE, ""));
  });
}

const UNORDERED_RE = /^[-*+]\s+/;
const ORDERED_RE = /^\d+\.\s+/;

/**
 * Toggle a list prefix on the selected line(s).
 *
 * - `ordered === false` → `- ` bullets.
 * - `ordered === true` → `1. `, `2. ` … renumbered sequentially across the block.
 *
 * If every line already carries the requested kind of marker, the list is
 * removed (toggle-off). Otherwise all lines get the marker, with any existing
 * list marker of either kind replaced so switching UL↔OL is one click.
 */
export function toggleList(sel: MdSelection, ordered: boolean): MdSelection {
  return transformLines(sel, (lines) => {
    const matcher = ordered ? ORDERED_RE : UNORDERED_RE;
    const allMarked = lines.every((line) => matcher.test(line));
    if (allMarked) {
      return lines.map((line) => line.replace(matcher, ""));
    }
    return lines.map((line, i) => {
      const stripped = line.replace(UNORDERED_RE, "").replace(ORDERED_RE, "");
      return ordered ? `${i + 1}. ${stripped}` : `- ${stripped}`;
    });
  });
}

/**
 * Wrap the selection as `[text](url)`.
 *
 * - Non-empty selection → `[selected](url)`, with the caret placed inside the
 *   `(url)` slot (selecting the url text when a default is used) so the user
 *   types the link target next.
 * - Empty selection → `[](url)` with the caret in the empty text slot.
 *
 * `url` defaults to `https://`; when defaulted the url portion after the scheme
 * is selected for easy typing.
 */
export function insertLink(sel: MdSelection, url?: string): MdSelection {
  const { value, start, end } = sel;
  const href = url ?? "https://";
  const usingDefault = url === undefined;
  const selected = value.slice(start, end);

  const inserted = `[${selected}](${href})`;
  const next = value.slice(0, start) + inserted + value.slice(end);

  if (start === end) {
    // Empty selection: caret goes in the text slot, just after the opening `[`.
    const caret = start + 1;
    return { value: next, start: caret, end: caret };
  }

  // Non-empty selection: position the caret/selection in the url slot.
  // `[selected](` is `1 + selected.length + 2` chars before the url begins.
  const urlStart = start + 1 + selected.length + 2;
  if (usingDefault) {
    // Select the portion after the `https://` scheme so typing replaces it.
    const caret = urlStart + href.length;
    return { value: next, start: caret, end: caret };
  }
  // Explicit url: drop the caret at the very end of the inserted link.
  const caret = urlStart + href.length + 1;
  return { value: next, start: caret, end: caret };
}

/**
 * Wrap the selection in a fenced code block (```` ``` ```` on their own lines).
 * The selection becomes the code body and stays selected. Fences are placed on
 * fresh lines: if the caret/selection isn't already at a line boundary a newline
 * is added before the opening fence (and after the closing fence as needed) so
 * the block never glues onto surrounding prose.
 */
export function insertCodeBlock(sel: MdSelection): MdSelection {
  const { value, start, end } = sel;
  const body = value.slice(start, end);

  const atLineStart = start === 0 || value[start - 1] === "\n";
  const atLineEnd = end === value.length || value[end] === "\n";

  const leadingNl = atLineStart ? "" : "\n";
  const trailingNl = atLineEnd ? "" : "\n";

  const opening = leadingNl + "```\n";
  const closing = "\n```" + trailingNl;
  const inserted = opening + body + closing;
  const next = value.slice(0, start) + inserted + value.slice(end);

  // Body sits right after the opening fence; keep it selected.
  const bodyStart = start + opening.length;
  return { value: next, start: bodyStart, end: bodyStart + body.length };
}

/**
 * Insert a horizontal rule (`---`) on its own line at the caret. Any active
 * selection is replaced. Newlines are added on each side only when the caret
 * isn't already at a line boundary, so the rule never merges with adjacent text.
 * The caret lands on the line *after* the rule, ready for the next block.
 */
export function insertHr(sel: MdSelection): MdSelection {
  const { value, start, end } = sel;
  const atLineStart = start === 0 || value[start - 1] === "\n";

  const leadingNl = atLineStart ? "" : "\n";

  // The rule line carries its own trailing newline; a leading newline is only
  // needed when the caret isn't already at the start of a line.
  const inserted = leadingNl + "---\n";
  const next = value.slice(0, start) + inserted + value.slice(end);

  const caret = start + inserted.length;
  return { value: next, start: caret, end: caret };
}

/** Matches a list-item prefix, capturing the marker so it can be continued. */
const LIST_ITEM_RE = /^(\s*)(?:([-*+])|(\d+)\.)(\s+)(.*)$/;

/**
 * Handle Enter pressed inside the editor (the caret is collapsed in practice;
 * any selection's start is used to locate the current line).
 *
 * - Current line is a *non-empty* list item → continue the list: insert a
 *   newline plus the same marker (next number for ordered lists) and place the
 *   caret after it.
 * - Current line is an *empty* list item (just the marker) → exit the list:
 *   remove the marker, leaving an empty line, caret at line start.
 * - Not a list item → return `null` so the caller lets the browser's default
 *   newline happen (preserving native undo/IME behaviour).
 */
export function handleListEnter(sel: MdSelection): MdSelection | null {
  const { value, start } = sel;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", lineStart);
  if (lineEnd === -1) lineEnd = value.length;
  const line = value.slice(lineStart, lineEnd);

  const match = line.match(LIST_ITEM_RE);
  if (!match) return null;

  const [, indent, bullet, orderedNum, gap, content] = match;

  if (content.length === 0) {
    // Empty item → exit the list. Remove the whole marker, leaving the indent
    // stripped too so the cursor returns to the margin.
    const next = value.slice(0, lineStart) + value.slice(lineEnd);
    return { value: next, start: lineStart, end: lineStart };
  }

  // Non-empty item → continue the list on a new line.
  let marker: string;
  if (bullet) {
    marker = `${indent}${bullet}${gap}`;
  } else {
    const nextNum = Number(orderedNum) + 1;
    marker = `${indent}${nextNum}.${gap}`;
  }

  const insertion = "\n" + marker;
  // Insert at the caret position (mirrors the browser inserting a newline there).
  const next = value.slice(0, start) + insertion + value.slice(start);
  const caret = start + insertion.length;
  return { value: next, start: caret, end: caret };
}

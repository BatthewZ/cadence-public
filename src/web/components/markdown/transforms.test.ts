import { describe, expect, it } from "vitest";

import {
  handleListEnter,
  insertCodeBlock,
  insertHr,
  insertLink,
  type MdSelection,
  toggleBlockquote,
  toggleHeading,
  toggleList,
  wrapInline,
} from "./transforms";

/**
 * These transforms are the entire behaviour of the markdown toolbar: each is a
 * pure string rewrite plus a caret/selection range the editor feeds straight
 * into `textarea.setSelectionRange`. The format stays plain markdown end-to-end
 * (swarm/plans/markdown.md §1), so correctness here *is* correctness of the
 * feature. The caret assertions matter most — getting the string right but the
 * caret wrong produces a subtly broken editor (typing lands in the wrong slot,
 * toggles stop round-tripping), so every case pins the exact range.
 *
 * A small helper renders a selection with `|` caret / `[…]` selection markers so
 * the expected caret math is human-readable in each assertion.
 */
function render(sel: MdSelection): string {
  if (sel.start === sel.end) {
    return sel.value.slice(0, sel.start) + "|" + sel.value.slice(sel.start);
  }
  return (
    sel.value.slice(0, sel.start) +
    "[" +
    sel.value.slice(sel.start, sel.end) +
    "]" +
    sel.value.slice(sel.end)
  );
}

describe("wrapInline", () => {
  it("inserts paired markers and places the caret between them on empty selection", () => {
    const result = wrapInline({ value: "", start: 0, end: 0 }, "**");
    expect(result.value).toBe("****");
    expect(result.start).toBe(2);
    expect(result.end).toBe(2);
    expect(render(result)).toBe("**|**");
  });

  it("wraps a non-empty selection and keeps the inner text selected", () => {
    const result = wrapInline({ value: "bold", start: 0, end: 4 }, "**");
    expect(result.value).toBe("**bold**");
    expect(render(result)).toBe("**[bold]**");
  });

  it("round-trips: wrapping then unwrapping (markers outside) restores the original", () => {
    const wrapped = wrapInline({ value: "bold", start: 0, end: 4 }, "**");
    // Selection is now the inner "bold" (start 2, end 6) with markers outside.
    const unwrapped = wrapInline(wrapped, "**");
    expect(unwrapped.value).toBe("bold");
    expect(render(unwrapped)).toBe("[bold]");
  });

  it("unwraps when the selection itself includes the markers", () => {
    const result = wrapInline({ value: "a **b** c", start: 2, end: 7 }, "**");
    expect(result.value).toBe("a b c");
    expect(render(result)).toBe("a [b] c");
  });

  it("wraps with underscore and backtick markers too", () => {
    expect(wrapInline({ value: "x", start: 0, end: 1 }, "_").value).toBe("_x_");
    expect(wrapInline({ value: "x", start: 0, end: 1 }, "`").value).toBe("`x`");
  });

  it("wraps a selection embedded in surrounding text without disturbing it", () => {
    const result = wrapInline({ value: "a code b", start: 2, end: 6 }, "`");
    expect(result.value).toBe("a `code` b");
    expect(render(result)).toBe("a `[code]` b");
  });
});

describe("toggleHeading", () => {
  it("adds a heading prefix to the current line", () => {
    const result = toggleHeading({ value: "Title", start: 0, end: 0 }, 1);
    expect(result.value).toBe("# Title");
    expect(render(result)).toBe("[# Title]");
  });

  it("clears the heading when level 0 is passed", () => {
    const result = toggleHeading({ value: "## Title", start: 3, end: 3 }, 0);
    expect(result.value).toBe("Title");
  });

  it("toggles the same level off (re-applying level 2 to an h2 clears it)", () => {
    const on = toggleHeading({ value: "Title", start: 0, end: 0 }, 2);
    expect(on.value).toBe("## Title");
    const off = toggleHeading(on, 2);
    expect(off.value).toBe("Title");
  });

  it("changes level rather than stacking markers", () => {
    const result = toggleHeading({ value: "# Title", start: 0, end: 0 }, 3);
    expect(result.value).toBe("### Title");
  });

  it("applies the heading to every line of a multi-line selection", () => {
    const result = toggleHeading({ value: "a\nb\nc", start: 0, end: 5 }, 2);
    expect(result.value).toBe("## a\n## b\n## c");
    expect(render(result)).toBe("[## a\n## b\n## c]");
  });
});

describe("toggleBlockquote", () => {
  it("adds a blockquote prefix to a single line", () => {
    const result = toggleBlockquote({ value: "quote me", start: 0, end: 0 });
    expect(result.value).toBe("> quote me");
    expect(render(result)).toBe("[> quote me]");
  });

  it("removes the prefix on toggle-off (round-trip)", () => {
    const on = toggleBlockquote({ value: "quote me", start: 0, end: 0 });
    const off = toggleBlockquote(on);
    expect(off.value).toBe("quote me");
  });

  it("quotes every line of a multi-line selection", () => {
    const result = toggleBlockquote({ value: "a\nb", start: 0, end: 3 });
    expect(result.value).toBe("> a\n> b");
  });

  it("quotes the whole block when only some lines are already quoted", () => {
    const result = toggleBlockquote({ value: "> a\nb", start: 0, end: 5 });
    expect(result.value).toBe("> a\n> b");
  });
});

describe("toggleList", () => {
  it("adds an unordered marker to a single line", () => {
    const result = toggleList({ value: "item", start: 0, end: 0 }, false);
    expect(result.value).toBe("- item");
  });

  it("adds ordered markers numbered sequentially across the block", () => {
    const result = toggleList({ value: "a\nb\nc", start: 0, end: 5 }, true);
    expect(result.value).toBe("1. a\n2. b\n3. c");
    expect(render(result)).toBe("[1. a\n2. b\n3. c]");
  });

  it("renumbers ordered lists sequentially regardless of source numbers", () => {
    const result = toggleList({ value: "x\ny\nz\nw", start: 0, end: 7 }, true);
    expect(result.value).toBe("1. x\n2. y\n3. z\n4. w");
  });

  it("removes the unordered markers on toggle-off (round-trip)", () => {
    const on = toggleList({ value: "a\nb", start: 0, end: 3 }, false);
    expect(on.value).toBe("- a\n- b");
    const off = toggleList(on, false);
    expect(off.value).toBe("a\nb");
  });

  it("removes ordered markers on toggle-off", () => {
    const on = toggleList({ value: "a\nb", start: 0, end: 3 }, true);
    expect(on.value).toBe("1. a\n2. b");
    const off = toggleList(on, true);
    expect(off.value).toBe("a\nb");
  });

  it("switches an unordered list to ordered in one toggle", () => {
    const result = toggleList({ value: "- a\n- b", start: 0, end: 7 }, true);
    expect(result.value).toBe("1. a\n2. b");
  });

  it("switches an ordered list to unordered in one toggle", () => {
    const result = toggleList({ value: "1. a\n2. b", start: 0, end: 9 }, false);
    expect(result.value).toBe("- a\n- b");
  });
});

describe("insertLink", () => {
  it("inserts a placeholder with the caret in the text slot on empty selection", () => {
    const result = insertLink({ value: "", start: 0, end: 0 });
    expect(result.value).toBe("[](https://)");
    expect(result.start).toBe(1);
    expect(result.end).toBe(1);
    expect(render(result)).toBe("[|](https://)");
  });

  it("wraps a non-empty selection and parks the caret after the default scheme", () => {
    const result = insertLink({ value: "click", start: 0, end: 5 });
    expect(result.value).toBe("[click](https://)");
    // caret after "https://", before the closing ")"
    expect(render(result)).toBe("[click](https://|)");
  });

  it("uses a provided url and places the caret at the end of the link", () => {
    const result = insertLink({ value: "click", start: 0, end: 5 }, "https://x.com");
    expect(result.value).toBe("[click](https://x.com)");
    expect(render(result)).toBe("[click](https://x.com)|");
  });

  it("wraps a selection embedded in surrounding text", () => {
    const result = insertLink({ value: "go here now", start: 3, end: 7 }, "https://a.b");
    expect(result.value).toBe("go [here](https://a.b) now");
  });
});

describe("insertCodeBlock", () => {
  it("fences an empty selection with the caret on the body line", () => {
    const result = insertCodeBlock({ value: "", start: 0, end: 0 });
    expect(result.value).toBe("```\n\n```");
    // body is empty, between the fences
    expect(render(result)).toBe("```\n|\n```");
  });

  it("fences a non-empty selection and keeps the body selected", () => {
    const result = insertCodeBlock({ value: "code here", start: 0, end: 9 });
    expect(result.value).toBe("```\ncode here\n```");
    expect(render(result)).toBe("```\n[code here]\n```");
  });

  it("adds separating newlines when the selection is mid-line", () => {
    const result = insertCodeBlock({ value: "abXYcd", start: 2, end: 4 });
    expect(result.value).toBe("ab\n```\nXY\n```\ncd");
    expect(render(result)).toBe("ab\n```\n[XY]\n```\ncd");
  });
});

describe("insertHr", () => {
  it("inserts a rule on its own line at the start of an empty doc", () => {
    const result = insertHr({ value: "", start: 0, end: 0 });
    expect(result.value).toBe("---\n");
    expect(render(result)).toBe("---\n|");
  });

  it("surrounds the rule with newlines when mid-line", () => {
    const result = insertHr({ value: "abcd", start: 2, end: 2 });
    expect(result.value).toBe("ab\n---\ncd");
    expect(render(result)).toBe("ab\n---\n|cd");
  });

  it("does not add a leading newline when already at line start", () => {
    const result = insertHr({ value: "line\n", start: 5, end: 5 });
    expect(result.value).toBe("line\n---\n");
  });
});

describe("handleListEnter", () => {
  it("returns null when the current line is not a list item", () => {
    expect(handleListEnter({ value: "plain text", start: 5, end: 5 })).toBeNull();
  });

  it("continues an unordered list with a fresh marker", () => {
    const result = handleListEnter({ value: "- first", start: 7, end: 7 });
    expect(result).not.toBeNull();
    expect(result!.value).toBe("- first\n- ");
    expect(render(result!)).toBe("- first\n- |");
  });

  it("continues an ordered list with the next number", () => {
    const result = handleListEnter({ value: "1. first", start: 8, end: 8 });
    expect(result!.value).toBe("1. first\n2. ");
    expect(render(result!)).toBe("1. first\n2. |");
  });

  it("continues an ordered list from an arbitrary current number", () => {
    const result = handleListEnter({ value: "1. a\n2. b\n3. c", start: 14, end: 14 });
    expect(result!.value).toBe("1. a\n2. b\n3. c\n4. ");
  });

  it("exits the list when the current item is empty (unordered)", () => {
    const result = handleListEnter({ value: "- ", start: 2, end: 2 });
    expect(result).not.toBeNull();
    expect(result!.value).toBe("");
    expect(result!.start).toBe(0);
    expect(result!.end).toBe(0);
  });

  it("exits the list when the current item is empty (ordered), removing only that line", () => {
    const result = handleListEnter({ value: "1. a\n2. ", start: 8, end: 8 });
    expect(result!.value).toBe("1. a\n");
    expect(result!.start).toBe(5);
    expect(result!.end).toBe(5);
  });

  it("preserves indentation when continuing a nested item", () => {
    const result = handleListEnter({ value: "  - nested", start: 10, end: 10 });
    expect(result!.value).toBe("  - nested\n  - ");
  });
});

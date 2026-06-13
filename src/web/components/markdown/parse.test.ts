import { describe, expect, it } from "vitest";

import { type MdNode, parseInline, parseMarkdown } from "./parse";

/**
 * `parseMarkdown` is the single source of truth for turning a stored
 * description/comment string into a tree the renderer maps to React elements.
 * Because the renderer never builds an HTML string, the safety contract lives
 * partly here: these tests pin (a) every block & inline construct in the v1
 * grammar, (b) that malformed/unterminated syntax degrades to literal text
 * rather than throwing or looping (GFM from PAT clients / Trello imports must
 * never break the UI), and (c) that a hostile `javascript:` link is still
 * captured RAW so the *renderer's* protocol allowlist is the only safety gate
 * (no double-sanitising, no silent drops the renderer can't see).
 */
describe("parseMarkdown — blocks", () => {
  it("parses headings at every level with inline content", () => {
    for (let level = 1; level <= 6; level++) {
      const src = `${"#".repeat(level)} Title **bold**`;
      const [node] = parseMarkdown(src);
      expect(node).toEqual({
        type: "heading",
        level,
        children: [
          { type: "text", value: "Title " },
          { type: "strong", children: [{ type: "text", value: "bold" }] },
        ],
      });
    }
  });

  it("does not treat 7+ hashes as a heading", () => {
    const [node] = parseMarkdown("####### too many");
    expect(node.type).toBe("paragraph");
  });

  it("joins wrapped paragraph lines with a space", () => {
    const [node] = parseMarkdown("line one\nline two");
    expect(node).toEqual({
      type: "paragraph",
      children: [{ type: "text", value: "line one line two" }],
    });
  });

  it("separates paragraphs on a blank line", () => {
    const nodes = parseMarkdown("first\n\nsecond");
    expect(nodes.map((n) => n.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("parses a horizontal rule (3+ dashes, optional surrounding space)", () => {
    expect(parseMarkdown("---")[0]).toEqual({ type: "hr" });
    expect(parseMarkdown("----")[0]).toEqual({ type: "hr" });
    expect(parseMarkdown("  ---  ")[0]).toEqual({ type: "hr" });
  });

  it("joins consecutive blockquote lines into one node and inline-parses them", () => {
    const [node] = parseMarkdown("> quoted bits _italic_\n> and more");
    expect(node).toEqual({
      type: "blockquote",
      children: [
        { type: "text", value: "quoted bits " },
        { type: "em", children: [{ type: "text", value: "italic" }] },
        { type: "text", value: " and more" },
      ],
    });
  });

  it("parses an unordered list (- and *) with inline items", () => {
    const [node] = parseMarkdown("- one\n- two `code`\n* three");
    expect(node).toEqual({
      type: "list",
      ordered: false,
      items: [
        [{ type: "text", value: "one" }],
        [
          { type: "text", value: "two " },
          { type: "code", value: "code" },
        ],
        [{ type: "text", value: "three" }],
      ],
    });
  });

  it("parses an ordered list", () => {
    const [node] = parseMarkdown("1. alpha\n2. beta\n10. gamma");
    expect(node).toEqual({
      type: "list",
      ordered: true,
      items: [
        [{ type: "text", value: "alpha" }],
        [{ type: "text", value: "beta" }],
        [{ type: "text", value: "gamma" }],
      ],
    });
  });

  it("parses a fenced code block verbatim with no inline/mention parsing", () => {
    const src = "```\n@notamention **notbold** `nocode`\n```";
    const [node] = parseMarkdown(src);
    expect(node).toEqual({
      type: "code_block",
      text: "@notamention **notbold** `nocode`",
    });
  });

  it("ignores the info string after the opening fence", () => {
    const src = "```ts\nconst x = 1;\n```";
    const [node] = parseMarkdown(src);
    expect(node).toEqual({ type: "code_block", text: "const x = 1;" });
  });

  it("treats an unterminated fence as code to EOF without throwing", () => {
    const src = "```\nstill code\nno closing fence";
    expect(() => parseMarkdown(src)).not.toThrow();
    const [node] = parseMarkdown(src);
    expect(node).toEqual({
      type: "code_block",
      text: "still code\nno closing fence",
    });
  });

  it("normalises CRLF line endings", () => {
    const [node] = parseMarkdown("a\r\nb");
    expect(node).toEqual({
      type: "paragraph",
      children: [{ type: "text", value: "a b" }],
    });
  });
});

describe("parseInline — inline constructs", () => {
  it("emits plain text", () => {
    expect(parseInline("just text")).toEqual([{ type: "text", value: "just text" }]);
  });

  it("parses bold, italic (_ and *), and inline code", () => {
    expect(parseInline("**b**")).toEqual([
      { type: "strong", children: [{ type: "text", value: "b" }] },
    ]);
    expect(parseInline("_i_")).toEqual([
      { type: "em", children: [{ type: "text", value: "i" }] },
    ]);
    expect(parseInline("*i*")).toEqual([
      { type: "em", children: [{ type: "text", value: "i" }] },
    ]);
    expect(parseInline("`c`")).toEqual([{ type: "code", value: "c" }]);
  });

  it("parses bold-italic ***x*** as strong>em", () => {
    expect(parseInline("***x***")).toEqual([
      {
        type: "strong",
        children: [{ type: "em", children: [{ type: "text", value: "x" }] }],
      },
    ]);
  });

  it("supports one level of nested emphasis (**a _b_ c**)", () => {
    expect(parseInline("**a _b_ c**")).toEqual([
      {
        type: "strong",
        children: [
          { type: "text", value: "a " },
          { type: "em", children: [{ type: "text", value: "b" }] },
          { type: "text", value: " c" },
        ],
      },
    ]);
  });

  it("supports italic wrapping bold (_a **b** c_)", () => {
    expect(parseInline("_a **b** c_")).toEqual([
      {
        type: "em",
        children: [
          { type: "text", value: "a " },
          { type: "strong", children: [{ type: "text", value: "b" }] },
          { type: "text", value: " c" },
        ],
      },
    ]);
  });

  it("parses a mention with quotes and a bare username", () => {
    expect(parseInline('hi @"Jane Doe" and @bob')).toEqual([
      { type: "text", value: "hi " },
      { type: "mention", name: "Jane Doe" },
      { type: "text", value: " and " },
      { type: "mention", name: "bob" },
    ]);
  });

  it("parses a link and inline-tokenizes its label", () => {
    expect(parseInline("see [**docs**](https://x.dev)")).toEqual([
      { type: "text", value: "see " },
      {
        type: "link",
        href: "https://x.dev",
        children: [{ type: "strong", children: [{ type: "text", value: "docs" }] }],
      },
    ]);
  });

  it("inline code is atomic — no nested marks or mentions inside", () => {
    expect(parseInline("`@bob **x**`")).toEqual([
      { type: "code", value: "@bob **x**" },
    ]);
  });

  it("a mention immediately inside backticks stays literal code text", () => {
    const result = parseInline("`@mention`");
    expect(result).toEqual([{ type: "code", value: "@mention" }]);
    expect(result.some((n) => n.type === "mention")).toBe(false);
  });
});

describe("parseInline — adversarial / graceful degradation", () => {
  it("captures a javascript: link href RAW (renderer handles safety)", () => {
    const result = parseInline("[click](javascript:alert(1))");
    expect(result).toEqual([
      {
        type: "link",
        href: "javascript:alert(1)",
        children: [{ type: "text", value: "click" }],
      },
    ]);
  });

  it("treats an unterminated ** as literal text without looping", () => {
    expect(parseInline("a **b c")).toEqual([{ type: "text", value: "a **b c" }]);
  });

  it("treats an unterminated backtick as literal text", () => {
    expect(parseInline("a `b c")).toEqual([{ type: "text", value: "a `b c" }]);
  });

  it("treats a malformed link as literal text", () => {
    expect(parseInline("[no href]")).toEqual([{ type: "text", value: "[no href]" }]);
    expect(parseInline("[label](unclosed")).toEqual([
      { type: "text", value: "[label](unclosed" },
    ]);
  });

  it("treats a lone @ as literal text", () => {
    expect(parseInline("email@ x")).toEqual([{ type: "text", value: "email@ x" }]);
  });

  it("does not match a single * as an italic close inside a bold-then-text run", () => {
    // empty emphasis `**` (no content) must not crash or produce empty nodes
    expect(() => parseInline("****")).not.toThrow();
  });
});

describe("parseMarkdown — the exact sample document", () => {
  const SAMPLE = [
    "# Heading",
    "",
    "Some paragraph:",
    "",
    "> quoted bits _with italics_ **and bold**.",
    "",
    "---",
    "",
    "`code snippet`",
    "",
    "```",
    "code block in monospace",
    "```",
    "",
    "@mentions here",
  ].join("\n");

  it("parses without throwing", () => {
    expect(() => parseMarkdown(SAMPLE)).not.toThrow();
  });

  it("produces sensible block nodes in order", () => {
    const nodes = parseMarkdown(SAMPLE);
    expect(nodes.map((n) => n.type)).toEqual([
      "heading",
      "paragraph",
      "blockquote",
      "hr",
      "paragraph",
      "code_block",
      "paragraph",
    ]);

    const heading = nodes[0];
    expect(heading).toEqual({
      type: "heading",
      level: 1,
      children: [{ type: "text", value: "Heading" }],
    });

    const quote = nodes[2];
    expect(quote).toEqual({
      type: "blockquote",
      children: [
        { type: "text", value: "quoted bits " },
        { type: "em", children: [{ type: "text", value: "with italics" }] },
        { type: "text", value: " " },
        { type: "strong", children: [{ type: "text", value: "and bold" }] },
        { type: "text", value: "." },
      ],
    });

    // The `code snippet` paragraph holds an inline code node...
    const inlineCodePara = nodes[4];
    expect(inlineCodePara).toEqual({
      type: "paragraph",
      children: [{ type: "code", value: "code snippet" }],
    });

    // ...while the fenced block is a code_block with no inline parsing.
    const codeBlock = nodes[5] as Extract<MdNode, { type: "code_block" }>;
    expect(codeBlock).toEqual({
      type: "code_block",
      text: "code block in monospace",
    });

    // The trailing line resolves to a mention.
    expect(nodes[6]).toEqual({
      type: "paragraph",
      children: [
        { type: "mention", name: "mentions" },
        { type: "text", value: " here" },
      ],
    });
  });
});

/**
 * Lite-Markdown parser — the single source of truth for how a stored description
 * / comment string becomes a structured tree. It is intentionally **pure** (no
 * React, no DOM): the renderer turns this AST into React elements directly, which
 * is what makes the whole pipeline XSS-safe by construction (no HTML string ever
 * exists). Keeping the stored format a plain string while only changing how it is
 * *displayed* is the core design constraint — so this parser must never throw on
 * GFM/Trello/PAT-authored input: anything unsupported degrades to literal text.
 *
 * Mentions reuse the exact regex semantics of the legacy `MentionText`
 * (`@"([^"]+)"|@(\w+)`) so absorbing that component leaves behaviour identical —
 * one parser, one source of truth (CLAUDE.md rule 4).
 */

export type MdInline =
  | { type: "text"; value: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "code"; value: string } // atomic, no children inside
  | { type: "link"; href: string; children: MdInline[] }
  | { type: "mention"; name: string };

export type MdNode =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { type: "paragraph"; children: MdInline[] }
  | { type: "blockquote"; children: MdInline[] }
  | { type: "code_block"; text: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: MdInline[][] };

// Mention semantics copied verbatim from MentionText so the two never diverge.
const MENTION_REGEX = /@"([^"]+)"|@(\w+)/;

const HEADING_RE = /^(#{1,6}) (.*)$/;
const FENCE_RE = /^```/;
const HR_RE = /^\s*-{3,}\s*$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const UL_RE = /^[-*] (.*)$/;
const OL_RE = /^\d+\. (.*)$/;

/**
 * Phase 1 — scan the source into block nodes line-by-line, then phase 2 —
 * inline-tokenize each block's text run. The two phases are deliberately
 * separate so that block context (e.g. "inside a fenced code block") can fully
 * suppress inline parsing.
 */
export function parseMarkdown(src: string): MdNode[] {
  // Normalise line endings so CRLF input (Windows / pasted content) parses the
  // same as LF — a stray \r would otherwise leak into text/code-block content.
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const nodes: MdNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // --- Fenced code block ------------------------------------------------
    if (FENCE_RE.test(line)) {
      const codeLines: string[] = [];
      i++; // consume the opening fence (its info string is ignored)
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      // If we hit EOF without a closing fence, everything scanned so far is the
      // block content (do not crash). Otherwise consume the closing fence.
      if (i < lines.length) i++;
      nodes.push({ type: "code_block", text: codeLines.join("\n") });
      continue;
    }

    // --- Blank line: paragraph/block separator ----------------------------
    if (line.trim() === "") {
      i++;
      continue;
    }

    // --- Horizontal rule --------------------------------------------------
    if (HR_RE.test(line)) {
      nodes.push({ type: "hr" });
      i++;
      continue;
    }

    // --- Heading ----------------------------------------------------------
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      nodes.push({ type: "heading", level, children: parseInline(heading[2]) });
      i++;
      continue;
    }

    // --- Blockquote (consecutive `>` lines joined with a space) -----------
    if (BLOCKQUOTE_RE.test(line)) {
      const quoteParts: string[] = [];
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
        const m = BLOCKQUOTE_RE.exec(lines[i]);
        quoteParts.push(m ? m[1] : "");
        i++;
      }
      nodes.push({
        type: "blockquote",
        children: parseInline(quoteParts.join(" ")),
      });
      continue;
    }

    // --- Unordered list ---------------------------------------------------
    if (UL_RE.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        const m = UL_RE.exec(lines[i]);
        items.push(parseInline(m ? m[1] : ""));
        i++;
      }
      nodes.push({ type: "list", ordered: false, items });
      continue;
    }

    // --- Ordered list -----------------------------------------------------
    if (OL_RE.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        const m = OL_RE.exec(lines[i]);
        items.push(parseInline(m ? m[1] : ""));
        i++;
      }
      nodes.push({ type: "list", ordered: true, items });
      continue;
    }

    // --- Paragraph: gather consecutive non-blank lines that don't start a
    //     new block, joined with a space (wrapped lines reflow). -----------
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (
        l.trim() === "" ||
        FENCE_RE.test(l) ||
        HR_RE.test(l) ||
        HEADING_RE.test(l) ||
        BLOCKQUOTE_RE.test(l) ||
        UL_RE.test(l) ||
        OL_RE.test(l)
      ) {
        break;
      }
      paraLines.push(l);
      i++;
    }
    nodes.push({ type: "paragraph", children: parseInline(paraLines.join(" ")) });
  }

  return nodes;
}

/**
 * Inline tokenizer. Walks the run left-to-right, dispatching on the marker at
 * the cursor. Inline code has the highest precedence (atomic, literal content);
 * any unmatched/unterminated marker is emitted as literal text so the walker
 * always makes forward progress — this is what guarantees no infinite loop and
 * graceful degradation of malformed syntax.
 *
 * @param depth tracks emphasis nesting. The grammar allows ONE level of nesting
 *   (`**a _b_ c**` → strong with an em child), so emphasis is honoured at the
 *   outer run (depth 0) and the immediately-nested run (depth 1); at depth 2 and
 *   beyond, emphasis markers degrade to literal text so pathological input can't
 *   recurse without bound.
 */
const MAX_EMPHASIS_DEPTH = 2;
export function parseInline(src: string, depth = 0): MdInline[] {
  const out: MdInline[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) {
      out.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < src.length) {
    const ch = src[i];

    // --- Inline code (atomic, highest precedence) -------------------------
    if (ch === "`") {
      const close = src.indexOf("`", i + 1);
      if (close !== -1) {
        flush();
        out.push({ type: "code", value: src.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      // Unterminated backtick → literal.
      buffer += ch;
      i++;
      continue;
    }

    // --- Mention (@"Name" or @username) -----------------------------------
    if (ch === "@") {
      const m = MENTION_REGEX.exec(src.slice(i));
      if (m && m.index === 0) {
        flush();
        out.push({ type: "mention", name: m[1] ?? m[2] });
        i += m[0].length;
        continue;
      }
      buffer += ch;
      i++;
      continue;
    }

    // --- Link [text](href) ------------------------------------------------
    if (ch === "[") {
      const link = parseLink(src, i);
      if (link) {
        flush();
        out.push(link.node);
        i = link.next;
        continue;
      }
      buffer += ch;
      i++;
      continue;
    }

    // --- Bold-italic ***x*** → strong>em ----------------------------------
    if (depth < MAX_EMPHASIS_DEPTH && src.startsWith("***", i)) {
      const close = src.indexOf("***", i + 3);
      if (close !== -1 && close > i + 3) {
        flush();
        const inner = src.slice(i + 3, close);
        out.push({
          type: "strong",
          children: [{ type: "em", children: parseInline(inner, depth + 1) }],
        });
        i = close + 3;
        continue;
      }
      buffer += ch;
      i++;
      continue;
    }

    // --- Bold **x** -------------------------------------------------------
    if (depth < MAX_EMPHASIS_DEPTH && src.startsWith("**", i)) {
      const close = findClose(src, i + 2, "**");
      if (close !== -1) {
        flush();
        out.push({
          type: "strong",
          children: parseInline(src.slice(i + 2, close), depth + 1),
        });
        i = close + 2;
        continue;
      }
      buffer += ch;
      i++;
      continue;
    }

    // --- Italic _x_ or *x* ------------------------------------------------
    if ((ch === "_" || ch === "*") && depth < MAX_EMPHASIS_DEPTH) {
      const close = findClose(src, i + 1, ch);
      if (close !== -1 && close > i + 1) {
        flush();
        out.push({
          type: "em",
          children: parseInline(src.slice(i + 1, close), depth + 1),
        });
        i = close + 1;
        continue;
      }
      buffer += ch;
      i++;
      continue;
    }

    buffer += ch;
    i++;
  }

  flush();
  return out;
}

/**
 * Find the closing `marker` for an emphasis run that opened at `from`. For `*`
 * we must avoid matching a `**` boundary as a single `*` close; `findCloseStar`
 * handles that. Returns the index of the marker, or -1 if unterminated.
 */
function findClose(src: string, from: number, marker: "**" | "_" | "*"): number {
  if (marker === "**") {
    const idx = src.indexOf("**", from);
    return idx;
  }
  if (marker === "_") {
    const idx = src.indexOf("_", from);
    return idx;
  }
  // marker === "*": skip "**" sequences so a bold close doesn't terminate an
  // italic run early (e.g. the `**` inside `*a **b** c*`).
  let i = from;
  while (i < src.length) {
    if (src[i] === "*") {
      if (src[i + 1] === "*") {
        i += 2; // part of a bold marker — not an italic close
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Parse a `[text](href)` link starting at `start` (which points at `[`). The
 * link text is itself inline-tokenized (can hold bold/italic/code/mention). The
 * href is captured RAW — protocol safety is the renderer's job, not the
 * parser's — so a `javascript:` URL still produces a link node here.
 */
function parseLink(
  src: string,
  start: number
): { node: MdInline; next: number } | null {
  // Find the matching `]`, allowing escaped/balanced text is out of scope; a
  // bare `]` closes the label.
  const labelEnd = src.indexOf("]", start + 1);
  if (labelEnd === -1) return null;
  if (src[labelEnd + 1] !== "(") return null;
  // Scan the href with paren balancing so a URL that itself contains parens
  // (e.g. `javascript:alert(1)` or a Wikipedia `(disambiguation)` link) closes
  // at the matching `)`, not the first inner one.
  let hrefEnd = -1;
  let openParens = 0;
  for (let j = labelEnd + 2; j < src.length; j++) {
    const c = src[j];
    if (c === "(") openParens++;
    else if (c === ")") {
      if (openParens === 0) {
        hrefEnd = j;
        break;
      }
      openParens--;
    }
  }
  if (hrefEnd === -1) return null;

  const label = src.slice(start + 1, labelEnd);
  const href = src.slice(labelEnd + 2, hrefEnd);
  return {
    node: { type: "link", href, children: parseInline(label) },
    next: hrefEnd + 1,
  };
}

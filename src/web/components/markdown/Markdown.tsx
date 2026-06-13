/**
 * Markdown renderer — turns a stored description/comment string into React
 * elements by walking the AST from {@link parseMarkdown} and emitting nodes
 * DIRECTLY. There is never an HTML string and never a `dangerouslySetInnerHTML`
 * call: that is what makes the whole display pipeline XSS-safe *by construction*
 * (CLAUDE.md rule 4 — single source of truth; see swarm/plans/markdown.md §2).
 *
 * The stored format stays a plain string end-to-end — this component only
 * changes how that string is *displayed*. Prose typography (heading scale,
 * spacing, code/blockquote/link styling) lives entirely in
 * `src/web/style/components/markdown.css` under the `.md` / `.md--compact`
 * classes, so this file contributes structure only and no inline styling.
 */
import { type ReactNode } from "react";

import { type WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { cn } from "@/web/util/style/style";

import {
  type MdInline,
  type MdNode,
  parseMarkdown,
} from "./parse";

/**
 * Protocols a link may point at. Anything else (notably `javascript:` and
 * `data:`) is rejected so a crafted description can never produce a clickable
 * script/data URL — the link's text is rendered as plain inline content with no
 * anchor at all, which is strictly safer than rendering an inert/`#` anchor.
 */
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Returns the trimmed href if its protocol is allow-listed, otherwise `null`.
 *
 * We parse with the URL API where possible (handles odd casing/whitespace and
 * protocol-relative quirks robustly), and fall back to a manual scheme check so
 * relative URLs without a scheme (which `new URL` rejects without a base) are
 * still treated as safe — a bare `/path` or `#anchor` has no dangerous
 * protocol. The check is case-insensitive after trimming, matching the plan's
 * link-safety requirement.
 */
function sanitizeHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (href === "") return null;

  // A leading scheme is `scheme:` where scheme starts with a letter and is
  // followed by letters/digits/`+`/`-`/`.`. If there is no scheme at all the
  // URL is relative and therefore carries no dangerous protocol.
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
  if (!schemeMatch) return href;

  const protocol = `${schemeMatch[1].toLowerCase()}:`;
  return SAFE_LINK_PROTOCOLS.has(protocol) ? href : null;
}

/**
 * Render a list of inline nodes. Keys are array indices: the whole tree is
 * recomputed wholesale on every render (the source string is the only input),
 * so positional keys are stable for a given string and never reorder.
 */
function renderInline(nodes: MdInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value;

      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;

      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;

      case "code":
        // Atomic: the raw value is rendered verbatim, never re-parsed.
        return <code key={index}>{node.value}</code>;

      case "mention":
        // Matches the legacy MentionText span exactly so absorbing that
        // component leaves the rendered mention pixel-identical.
        return (
          <span
            key={index}
            className="inline-flex items-center rounded px-1 py-0.5 text-fg-primary bg-primary/10 font-medium"
          >
            @{node.name}
          </span>
        );

      case "link": {
        const safeHref = sanitizeHref(node.href);
        const children = renderInline(node.children);
        // Disallowed protocol → render the label as plain inline content with
        // NO anchor, so there is nothing clickable to exploit.
        if (safeHref === null) {
          return <span key={index}>{children}</span>;
        }
        return (
          <a
            key={index}
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        );
      }

      default:
        // Exhaustive: every MdInline variant is handled above. This keeps the
        // switch total so a new AST node type surfaces as a type error here.
        return null;
    }
  });
}

/** Render a single block node to its corresponding prose element. */
function renderBlock(node: MdNode, index: number): ReactNode {
  switch (node.type) {
    case "heading": {
      const children = renderInline(node.children);
      switch (node.level) {
        case 1:
          return <h1 key={index}>{children}</h1>;
        case 2:
          return <h2 key={index}>{children}</h2>;
        case 3:
          return <h3 key={index}>{children}</h3>;
        case 4:
          return <h4 key={index}>{children}</h4>;
        case 5:
          return <h5 key={index}>{children}</h5>;
        case 6:
          return <h6 key={index}>{children}</h6>;
        default:
          return null;
      }
    }

    case "paragraph":
      return <p key={index}>{renderInline(node.children)}</p>;

    case "blockquote":
      return <blockquote key={index}>{renderInline(node.children)}</blockquote>;

    case "code_block":
      // Raw text, whitespace preserved, no inline parsing (handled by `<pre>`).
      return (
        <pre key={index}>
          <code>{node.text}</code>
        </pre>
      );

    case "hr":
      return <hr key={index} />;

    case "list": {
      const items = node.items.map((item, itemIndex) => (
        <li key={itemIndex}>{renderInline(item)}</li>
      ));
      return node.ordered ? (
        <ol key={index}>{items}</ol>
      ) : (
        <ul key={index}>{items}</ul>
      );
    }

    default:
      return null;
  }
}

interface MarkdownProps {
  /** Raw, stored markdown string (the canonical format). */
  children: string;
  /**
   * Workspace members, accepted for API symmetry and future mention resolution.
   * Mention AST nodes already carry their display `name`, so rendering does not
   * require this today — but the editor/preview pass it and a later increment
   * may resolve avatars/links from it, so the prop is kept stable.
   */
  members?: WorkspaceMember[];
  /** Sidebar/inline contexts pass `compact` for the tighter prose scale. */
  density?: "comfortable" | "compact";
  className?: string;
}

export function Markdown({
  children,
  density = "comfortable",
  className,
}: MarkdownProps): React.JSX.Element {
  const nodes = parseMarkdown(children);

  return (
    <div className={cn("md", density === "compact" && "md--compact", className)}>
      {nodes.map((node, index) => renderBlock(node, index))}
    </div>
  );
}

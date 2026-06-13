/**
 * Renderer tests. These lock the two properties that matter most:
 *  1. The AST → React mapping produces the correct prose elements inside the
 *     `.md` container (so the typography scale in markdown.css applies).
 *  2. Link safety is enforced *by construction* — a disallowed protocol yields
 *     NO anchor at all, which is the XSS guarantee the whole pipeline rests on
 *     (swarm/plans/markdown.md §2). A regression here is a security regression,
 *     not a cosmetic one, which is why it is asserted explicitly.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders a heading with the correct tag inside the .md container", () => {
    const { container } = render(<Markdown>{"# Hello"}</Markdown>);

    const root = container.querySelector("div");
    expect(root).not.toBeNull();
    expect(root?.classList.contains("md")).toBe(true);
    expect(root?.classList.contains("md--compact")).toBe(false);

    const heading = container.querySelector("h1");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("Hello");
    // The heading must live inside the prose container so the scoped scale wins.
    expect(root?.contains(heading)).toBe(true);
  });

  it("maps heading levels 1-6 to the matching tag", () => {
    const { container } = render(
      <Markdown>{"# h1\n\n## h2\n\n###### h6"}</Markdown>
    );
    expect(container.querySelector("h1")?.textContent).toBe("h1");
    expect(container.querySelector("h2")?.textContent).toBe("h2");
    expect(container.querySelector("h6")?.textContent).toBe("h6");
  });

  it("adds the md--compact class in compact density", () => {
    const { container } = render(
      <Markdown density="compact">{"# Hello"}</Markdown>
    );
    const root = container.querySelector("div");
    expect(root?.classList.contains("md")).toBe(true);
    expect(root?.classList.contains("md--compact")).toBe(true);
  });

  it("defaults to comfortable density (no md--compact)", () => {
    const { container } = render(<Markdown>{"text"}</Markdown>);
    const root = container.querySelector("div");
    expect(root?.classList.contains("md--compact")).toBe(false);
  });

  it("merges a custom className onto the container", () => {
    const { container } = render(
      <Markdown className="my-extra">{"text"}</Markdown>
    );
    const root = container.querySelector("div");
    expect(root?.classList.contains("md")).toBe(true);
    expect(root?.classList.contains("my-extra")).toBe(true);
  });

  it("renders a valid https link as an anchor opening in a new tab safely", () => {
    const { container } = render(
      <Markdown>{"[site](https://example.com)"}</Markdown>
    );
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("https://example.com");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor?.textContent).toBe("site");
  });

  it("renders a mailto: link as a valid anchor", () => {
    const { container } = render(
      <Markdown>{"[mail](mailto:a@b.com)"}</Markdown>
    );
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("mailto:a@b.com");
  });

  it("renders a javascript: link as plain text with NO anchor", () => {
    const { container } = render(
      <Markdown>{"[click](javascript:alert(1))"}</Markdown>
    );
    // The dangerous protocol must produce nothing clickable.
    expect(container.querySelector("a")).toBeNull();
    // ...but the label text is preserved as inline content.
    expect(container.textContent).toContain("click");
  });

  it("renders a data: link as plain text with NO anchor", () => {
    const { container } = render(
      <Markdown>{"[x](data:text/html,<script>1</script>)"}</Markdown>
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("x");
  });

  it("renders a mention as the styled span", () => {
    const { container } = render(<Markdown>{'Hi @"Jane Doe"'}</Markdown>);
    const span = container.querySelector("span.bg-primary\\/10");
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe("@Jane Doe");
    expect(span?.className).toContain("inline-flex");
    expect(span?.className).toContain("font-medium");
  });

  it("preserves raw text in a fenced code block without inline parsing", () => {
    const raw = "const x = `a` **b**;";
    const { container } = render(
      <Markdown>{"```\n" + raw + "\n```"}</Markdown>
    );
    const pre = container.querySelector("pre");
    const code = pre?.querySelector("code");
    expect(pre).not.toBeNull();
    expect(code).not.toBeNull();
    // The literal source survives: no <strong>, no inline <code> children.
    expect(code?.textContent).toBe(raw);
    expect(pre?.querySelector("strong")).toBeNull();
  });

  it("renders bold, italic and inline code with the correct tags", () => {
    const { container } = render(
      <Markdown>{"a **bold** and _italic_ and `mono`"}</Markdown>
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    // Inline code is an inline <code>, distinct from a fenced <pre><code>.
    const inlineCode = container.querySelector("code");
    expect(inlineCode?.textContent).toBe("mono");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renders ordered and unordered lists with li children", () => {
    const { container: ul } = render(
      <Markdown>{"- one\n- two"}</Markdown>
    );
    expect(ul.querySelector("ul")).not.toBeNull();
    expect(ul.querySelectorAll("li").length).toBe(2);

    const { container: ol } = render(
      <Markdown>{"1. one\n2. two"}</Markdown>
    );
    expect(ol.querySelector("ol")).not.toBeNull();
    expect(ol.querySelectorAll("li").length).toBe(2);
  });

  it("renders a blockquote and a horizontal rule", () => {
    const { container } = render(
      <Markdown>{"> quoted\n\n---"}</Markdown>
    );
    expect(container.querySelector("blockquote")?.textContent).toBe("quoted");
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders an empty container for whitespace-only input", () => {
    const { container } = render(<Markdown>{"   \n  "}</Markdown>);
    const root = container.querySelector("div.md");
    expect(root).not.toBeNull();
    // No block children were produced from blank input.
    expect(root?.children.length).toBe(0);
  });
});

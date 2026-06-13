import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "./MarkdownEditor";

/**
 * MarkdownEditor is the convergence component (swarm/plans/markdown.md §4): a
 * controlled textarea + toolbar + Write/Preview tabs over the canonical markdown
 * string. These tests pin the contract that matters to a consumer: edits
 * propagate verbatim via `onChange`, the toolbar applies the pure transforms to
 * the live selection (Bold wraps `**`), Preview renders the markdown through the
 * `Markdown` renderer, and `disabled` makes the surface inert.
 *
 * jsdom doesn't compute caret pixel coordinates, so mention-dropdown positioning
 * is deliberately not asserted here.
 */

/**
 * A controlled host so the editor behaves like it does in the app: `onChange`
 * feeds the value straight back as the `value` prop, which is what makes the
 * caret-restoration layout-effect (and toggle round-tripping) observable.
 */
function ControlledEditor(props: {
  initial?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  collapsible?: boolean;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <MarkdownEditor
      value={value}
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
      disabled={props.disabled}
      collapsible={props.collapsible}
    />
  );
}

describe("MarkdownEditor", () => {
  it("propagates typed text through onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(v: string) => void>();
    render(<ControlledEditor onChange={onChange} />);

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "hi");

    expect(onChange).toHaveBeenCalled();
    expect(textarea).toHaveValue("hi");
  });

  it("wraps the current selection in ** when Bold is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(v: string) => void>();
    render(<ControlledEditor initial="bold" onChange={onChange} />);

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    // Select the whole word so the Bold transform wraps it.
    textarea.focus();
    textarea.setSelectionRange(0, 4);

    await user.click(screen.getByRole("button", { name: "Bold" }));

    expect(onChange).toHaveBeenLastCalledWith("**bold**");
    expect(textarea).toHaveValue("**bold**");
  });

  it("renders the markdown in the Preview tab", async () => {
    const user = userEvent.setup();
    const { container } = render(<ControlledEditor initial={"# Title"} />);

    await user.click(screen.getByRole("button", { name: "Preview" }));

    const heading = container.querySelector(".md h1");
    expect(heading).not.toBeNull();
    expect(heading).toHaveTextContent("Title");
  });

  it("shows a muted placeholder in Preview when there is nothing to preview", async () => {
    const user = userEvent.setup();
    render(<ControlledEditor initial="   " />);

    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByText("Nothing to preview")).toBeInTheDocument();
  });

  it("disables the textarea when disabled", () => {
    render(<ControlledEditor initial="x" disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("hides the toolbar in collapsible mode until the textarea is focused", async () => {
    const user = userEvent.setup();
    render(<ControlledEditor collapsible />);

    // Empty + unfocused: the chrome (and therefore the Bold button) is hidden,
    // so the composer reads as a single quiet input — but the textarea (and its
    // @mention behaviour) is still mounted and usable.
    expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // Engaging the input reveals the full editor chrome.
    await user.click(screen.getByRole("textbox"));
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
  });

  it("shows the toolbar immediately in collapsible mode when a draft already exists", () => {
    render(<ControlledEditor collapsible initial="draft" />);
    // Pre-existing content means the user has something to format/preview, so
    // the chrome is revealed without needing focus first.
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
  });

  it("collapses out of Preview when a collapsible editor is cleared (post-submit)", async () => {
    // Repro of the composer bug: preview a draft, then the parent clears `value`
    // on submit. The editor must snap back to Write and hide its chrome rather
    // than stay in Preview showing "Nothing to preview".
    const user = userEvent.setup();

    function Host() {
      const [value, setValue] = useState("hello");
      return (
        <>
          <MarkdownEditor collapsible value={value} onChange={setValue} />
          <button type="button" onClick={() => setValue("")}>
            submit
          </button>
        </>
      );
    }

    render(<Host />);
    // Draft present → chrome visible → switch to Preview.
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("hello")).toBeInTheDocument();

    // Parent clears the value (as the comment submit handler does).
    await user.click(screen.getByRole("button", { name: "submit" }));

    // Back to a collapsed Write surface: no Preview placeholder, no toolbar.
    expect(screen.queryByText("Nothing to preview")).toBeNull();
    expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("applies the Bold keyboard shortcut to the selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(v: string) => void>();
    render(<ControlledEditor initial="word" onChange={onChange} />);

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.focus();
    textarea.setSelectionRange(0, 4);

    await user.keyboard("{Control>}b{/Control}");

    expect(onChange).toHaveBeenLastCalledWith("**word**");
  });
});

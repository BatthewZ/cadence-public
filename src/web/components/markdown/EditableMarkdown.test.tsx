import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { EditableMarkdown } from "./EditableMarkdown";

/**
 * EditableMarkdown is the click-to-edit wrapper (swarm/plans/markdown.md §4).
 * These tests pin the LOCKED decisions a consumer relies on:
 *
 *   - view mode renders the markdown (and a muted placeholder when empty),
 *   - clicking (or Enter/Space) enters edit mode showing Save/Cancel,
 *   - Save passes the edited string to `onSave` verbatim and returns to view,
 *   - Cancel discards the draft (onSave untouched, original prose shown),
 *   - `readOnly` is inert — no affordance, clicking never edits, no Save button,
 *   - Esc cancels, ⌘/Ctrl+Enter saves,
 *   - clicking away / blurring the textarea KEEPS edit mode open (the critical
 *     anti-data-loss guarantee — there is deliberately no blur-to-save).
 */

/**
 * A controlled host mirroring the app: a successful `onSave` updates `value`,
 * which is what makes the view↔edit round-trip (and "parent owns value")
 * observable. `onSave` is injectable so tests can make it resolve or reject.
 */
function ControlledEditable(props: {
  initial?: string;
  onSave?: (next: string) => Promise<void>;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <EditableMarkdown
      value={value}
      readOnly={props.readOnly}
      placeholder={props.placeholder}
      onSave={async (next) => {
        await props.onSave?.(next);
        setValue(next);
      }}
    />
  );
}

describe("EditableMarkdown", () => {
  it("renders the markdown in view mode", () => {
    render(<ControlledEditable initial="# Title" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Title" }),
    ).toBeInTheDocument();
  });

  it("shows the muted placeholder when the value is empty", () => {
    render(<ControlledEditable initial="" placeholder="Add details…" />);
    expect(screen.getByText("Add details…")).toBeInTheDocument();
  });

  it("clicking a link in view mode follows the link instead of entering edit mode", async () => {
    // A user clicking a rendered link genuinely means to open it, not to start
    // editing — so the click must NOT swap the field into the editor.
    const user = userEvent.setup();
    render(<ControlledEditable initial="See [google](https://google.com)" />);

    await user.click(screen.getByRole("link", { name: "google" }));

    // Still in view mode: no textarea/Save appeared.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });

  it("enters edit mode on click, revealing Save and Cancel", async () => {
    const user = userEvent.setup();
    render(<ControlledEditable initial="hello" />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit description" }));

    expect(screen.getByRole("textbox")).toHaveValue("hello");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("enters edit mode via the keyboard (Enter on the focused view)", async () => {
    const user = userEvent.setup();
    render(<ControlledEditable initial="hello" />);

    const view = screen.getByRole("button", { name: "Edit description" });
    view.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("Save passes the edited string to onSave and returns to view mode", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(next: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    render(<ControlledEditable initial="hello" onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Edit description" }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "world");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith("world");
    await waitFor(() => {
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("Cancel discards the draft and shows the original value", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(next: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    render(<ControlledEditable initial="original" onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Edit description" }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "scratch edit");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("original")).toBeInTheDocument();
  });

  it("Esc cancels edit mode without saving", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(next: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    render(<ControlledEditable initial="keep me" onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Edit description" }));
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, " changed");
    await user.keyboard("{Escape}");

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("keep me")).toBeInTheDocument();
  });

  it("Ctrl/Cmd+Enter saves the draft", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(next: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    render(<ControlledEditable initial="start" onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Edit description" }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "via shortcut");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onSave).toHaveBeenCalledExactlyOnceWith("via shortcut");
    await waitFor(() => {
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  it("keeps edit mode open when focus leaves the textarea (no blur-to-save)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(next: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    render(
      <div>
        <ControlledEditable initial="hello" onSave={onSave} />
        <button type="button">Elsewhere</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Edit description" }));
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();

    // Blur the textarea by clicking an unrelated element outside the editor.
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    // Edit mode must remain open and nothing should have been persisted.
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("stays in edit mode with the draft intact when onSave rejects", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(next: string) => Promise<void>>(() =>
      Promise.reject(new Error("boom")),
    );
    render(<ControlledEditable initial="hello" onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Edit description" }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "retry me");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith("retry me");
    // Editor remains open with the unsaved draft so the user can retry.
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("retry me");
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("readOnly renders inert prose with no edit affordance", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(next: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    render(
      <ControlledEditable initial="read only text" readOnly onSave={onSave} />,
    );

    expect(screen.getByText("read only text")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit description" }),
    ).not.toBeInTheDocument();

    // Clicking the prose does nothing.
    await user.click(screen.getByText("read only text"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });
});

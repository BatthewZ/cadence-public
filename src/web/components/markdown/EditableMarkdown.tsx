/**
 * EditableMarkdown — the click-to-edit wrapper that turns a rendered markdown
 * field into an inline-editable surface (think Linear/Notion description fields).
 * It is the Wave-4 convergence point (swarm/plans/markdown.md §4, §6): view mode
 * renders {@link Markdown}; entering edit mode swaps in {@link MarkdownEditor}
 * plus an explicit Save/Cancel footer.
 *
 * **Why explicit Save/Cancel only (decision locked, plan §4 / §5).** Long-form
 * markdown authoring routinely loses focus — clicking the toolbar, opening the
 * mention dropdown, tabbing to a Button, or the browser stealing focus on an IME
 * commit all blur the textarea. A blur-to-save or click-outside-to-close handler
 * would silently end the edit mid-thought and is a classic data-loss footgun, so
 * this component intentionally has NEITHER. The ONLY ways out of edit mode are
 * Save, Cancel, ⌘/Ctrl+Enter (save), or Esc (cancel). Clicking away does nothing.
 *
 * **Why the parent owns persistence + errors.** `onSave` returns a promise; on
 * resolve we drop back to view mode (the parent has updated `value`), on reject
 * we STAY in edit mode with the draft intact so the user can retry — the parent
 * surfaces its own error toast. We never mangle the string (no trimming): the
 * parent decides empty/null handling, keeping the stored markdown the single
 * source of truth (CLAUDE.md rule 4).
 *
 * **Why dirty-draft protection.** A background refetch can change `value` while
 * the user is mid-edit. Re-seeding `draft` from `value` on every change would
 * clobber unsaved typing, so we only seed `draft` when ENTERING edit mode; an
 * open draft is never overwritten by an incoming `value` (mirrors the dirty-field
 * guard in use-task-editing.ts).
 */
import { type KeyboardEvent, type MouseEvent, useState } from "react";

import { Button } from "@/web/components/ui/Button";
import { type WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { cn } from "@/web/util/style/style";

import { Markdown } from "./Markdown";
import { MarkdownEditor } from "./MarkdownEditor";

interface EditableMarkdownProps {
  /** Raw, stored markdown string (the canonical format). */
  value: string;
  /**
   * Persist the edited markdown. Resolve → exit to view mode; reject → stay in
   * edit mode (parent shows its own error toast) so the user can retry.
   */
  onSave: (next: string) => Promise<void>;
  /** Workspace members for mention resolution in both render and editor. */
  members?: WorkspaceMember[];
  /** When true the field is plain rendered prose — never editable, no affordance. */
  readOnly?: boolean;
  /** Sidebar/inline contexts pass `compact` for the tighter prose scale. */
  density?: "comfortable" | "compact";
  /** Muted prompt shown when `value` is empty/whitespace. */
  placeholder?: string;
}

const DEFAULT_PLACEHOLDER = "Add a description…";

export function EditableMarkdown(
  props: EditableMarkdownProps,
): React.JSX.Element {
  const {
    value,
    onSave,
    members,
    readOnly = false,
    density = "comfortable",
    placeholder,
  } = props;

  const [editing, setEditing] = useState(false);
  // Seeded from `value` only when entering edit mode (see file header) so a
  // background `value` change never clobbers an in-progress draft.
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const isEmpty = value.trim().length === 0;
  const placeholderText = placeholder ?? DEFAULT_PLACEHOLDER;

  const enterEdit = (): void => {
    if (readOnly || editing) return;
    setDraft(value);
    setEditing(true);
  };

  const cancel = (): void => {
    if (saving) return;
    setEditing(false);
  };

  const save = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      // Pass `draft` through unchanged — the parent decides empty/null handling.
      await onSave(draft);
      setEditing(false);
    } catch {
      // Stay in edit mode with the draft intact so the user can retry; the
      // parent surfaces the error toast.
    } finally {
      setSaving(false);
    }
  };

  // ---- VIEW MODE ----------------------------------------------------------
  if (!editing) {
    const rendered = isEmpty ? (
      <p className="text-body-2 text-fg-muted">{placeholderText}</p>
    ) : (
      <Markdown density={density} members={members}>
        {value}
      </Markdown>
    );

    // Read-only: plain prose, no affordance, not focusable, never editable.
    if (readOnly) {
      return <div className="text-fg-primary">{rendered}</div>;
    }

    // Editable: a button-role surface so it is keyboard-accessible — Enter/Space
    // enter edit mode, matching a native button, with a descriptive aria-label.
    // BUT a click/Enter that lands on a rendered link must follow the link, not
    // start editing — a user clicking a link genuinely means to open it.
    const isLinkTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement && target.closest("a") !== null;

    const handleViewClick = (event: MouseEvent<HTMLDivElement>): void => {
      if (isLinkTarget(event.target)) return;
      enterEdit();
    };

    const handleViewKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
      if (isLinkTarget(event.target)) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        enterEdit();
      }
    };

    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Edit description"
        onClick={handleViewClick}
        onKeyDown={handleViewKeyDown}
        className={cn(
          // The horizontal padding gives the hover/focus affordance box room to
          // breathe around the text, but on its own it indents the rendered
          // prose past the section's "Description" label, leaving it visibly
          // misaligned with every other sidebar row. `-mx-r5` cancels the
          // inline padding so the *text* lines up flush with the label while the
          // affordance box bleeds outward into the section's `px-r3` gutter.
          // The negative margin and padding MUST stay equal so the text stays
          // flush — the bleed is intentionally a notch smaller than the gutter
          // (r5 < r3) so the box keeps a visible breathing gap from the panel
          // edge instead of crowding it. Edit mode keeps the full editor width.
          "cursor-text rounded-md border border-transparent -mx-r5 px-r5 py-r5 text-fg-primary",
          "duration-fast hover:border-border-default hover:bg-surface-1",
          "focus:outline-none focus-visible:border-border-focus focus-visible:bg-surface-1",
        )}
      >
        {rendered}
      </div>
    );
  }

  // ---- EDIT MODE ----------------------------------------------------------
  // Save on ⌘/Ctrl+Enter, cancel on Esc. These are the ONLY keyboard exits;
  // there is deliberately no blur/click-outside handler (decision locked).
  const handleEditKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void save();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  return (
    <div className="flex flex-col gap-r5" onKeyDown={handleEditKeyDown}>
      <MarkdownEditor
        value={draft}
        onChange={setDraft}
        members={members}
        density={density}
        disabled={saving}
        autoFocus
      />

      {/* Footer hugs the editor; Cancel is a quiet ghost so the accent Save is
          the single primary action. Shortcuts live on the buttons as tooltips
          (⌘↵ / Esc) instead of a full-width hint band. */}
      <div className="flex items-center justify-end gap-r4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={cancel}
          disabled={saving}
          title="Esc"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void save()}
          disabled={saving}
          title="⌘↵"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

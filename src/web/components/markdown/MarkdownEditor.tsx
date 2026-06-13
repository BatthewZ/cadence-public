/**
 * MarkdownEditor — the convergence component for the lite-markdown feature.
 *
 * It wires together every piece built earlier in the plan (swarm/plans/markdown.md
 * §4, §6) into a single authoring surface:
 *
 *   - a `<textarea>` (the canonical markdown string is edited verbatim — no
 *     contenteditable, so selection/IME/undo stay browser-native),
 *   - the pure selection {@link transforms} (toolbar + keyboard shortcuts),
 *   - the {@link MarkdownToolbar} (presentational command emitter),
 *   - {@link useMentionAutocomplete} + {@link MentionSuggestions} for `@mentions`,
 *   - the {@link Markdown} renderer for the Preview tab.
 *
 * The stored format never changes: the parent always receives a plain markdown
 * string via `onChange`. This component only governs how that string is authored
 * and previewed.
 *
 * **Caret restoration is the load-bearing detail.** The textarea is controlled,
 * so applying a transform means calling `onChange(next.value)` and waiting for
 * the parent re-render before the new value lands in the DOM. Restoring the
 * selection synchronously would clobber it against the stale value, so we stash
 * the desired `[start, end]` range in a ref and reapply it in a
 * `useLayoutEffect` keyed on `value` — after React commits the new value but
 * before the browser paints, so the caret never visibly jumps.
 */
import { Eye, Pencil } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { MentionSuggestions } from "@/web/components/form/MentionSuggestions";
import { IconButton } from "@/web/components/ui/IconButton";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { useMentionAutocomplete } from "@/web/hooks/use-mention-autocomplete";
import { cn } from "@/web/util/style/style";

import { Markdown } from "./Markdown";
import { type MarkdownCommand, MarkdownToolbar } from "./MarkdownToolbar";
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

type EditorMode = "write" | "preview";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  members?: WorkspaceMember[];
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Density passed through to the Preview render. Defaults to "comfortable". */
  density?: "comfortable" | "compact";
  /**
   * Progressive-disclosure mode for low-friction surfaces like the comment
   * composer. When true, the toolbar / Preview chrome stays hidden until the
   * textarea is focused or already holds content — so an empty composer reads as
   * a single quiet input, then reveals the full editor the moment the user
   * engages. Crucially the *same* textarea stays mounted across the transition
   * (no remount, no focus loss, no caret jump): only the chrome row's visibility
   * toggles, which is why this lives inside the editor rather than a parent that
   * swaps between two different components.
   */
  collapsible?: boolean;
}

/**
 * Map a toolbar command onto the matching pure transform. Each branch operates
 * on the live `{value, start, end}` selection read from the textarea and returns
 * a fresh {@link MdSelection}. Centralised here so the toolbar and keyboard
 * shortcut paths share one command → transform mapping (single source of truth).
 */
function applyCommand(command: MarkdownCommand, sel: MdSelection): MdSelection {
  switch (command.type) {
    case "wrap":
      return wrapInline(sel, command.marker);
    case "heading":
      return toggleHeading(sel, 1);
    case "blockquote":
      return toggleBlockquote(sel);
    case "list":
      return toggleList(sel, command.ordered);
    case "link":
      return insertLink(sel);
    case "codeblock":
      return insertCodeBlock(sel);
    case "hr":
      return insertHr(sel);
    default:
      // Exhaustive: every MarkdownCommand variant is handled above, so a new
      // command surfaces here as a type error rather than a silent no-op.
      return sel;
  }
}

export function MarkdownEditor(props: MarkdownEditorProps): React.JSX.Element {
  const {
    value,
    onChange,
    members,
    placeholder,
    disabled,
    autoFocus,
    density = "comfortable",
    collapsible = false,
  } = props;

  const [mode, setMode] = useState<EditorMode>("write");
  // Tracks textarea focus so the `collapsible` surface knows when to reveal its
  // chrome. Always maintained (cheap) but only consulted when `collapsible`.
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Selection range to restore once the controlled `value` has committed. `null`
   * when no transform is pending, so ordinary typing (which already moves the
   * caret natively) is never disturbed.
   */
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);

  const mention = useMentionAutocomplete({
    textareaRef,
    value,
    onChange,
    members: members ?? [],
  });

  // Reapply the post-transform selection after the new value commits but before
  // paint — the controlled textarea only holds the new string at this point, so
  // setSelectionRange now lands on the right characters with no visible jump.
  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending) return;
    pendingSelectionRef.current = null;

    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(pending.start, pending.end);
  }, [value]);

  // autoFocus once on mount (only meaningful in Write mode where the textarea
  // exists). A ref latch makes the effect idempotent so re-runs from changing
  // deps never re-steal focus, keeping the dep array honest (no lint suppression).
  const didAutoFocusRef = useRef(false);
  useLayoutEffect(() => {
    if (didAutoFocusRef.current) return;
    didAutoFocusRef.current = true;
    if (autoFocus && !disabled) {
      textareaRef.current?.focus();
    }
  }, [autoFocus, disabled]);

  // Auto-grow the textarea to fit its content (capped by the CSS max-height,
  // beyond which the styled thin scrollbar takes over). Reset to "auto" first so
  // the field can also SHRINK when content is deleted, not just grow.
  useLayoutEffect(() => {
    if (mode !== "write") return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value, mode]);

  /**
   * Shared selection-read → transform → onChange → restore pipeline used by the
   * toolbar, the formatting shortcuts, AND the list-continuation Enter handler.
   * Reads the LIVE selection from the textarea so the transform operates on
   * exactly what the user has highlighted, then stashes the returned range for
   * the layout-effect to restore.
   *
   * A transform may return `null` to mean "no applicable edit here" (the list
   * Enter handler uses this to fall through to the browser's native newline).
   * Returns `true` only when a real edit was propagated, so keyboard callers
   * know whether to `preventDefault` the originating key.
   */
  const applyTransform = useCallback(
    (transform: (sel: MdSelection) => MdSelection | null): boolean => {
      const textarea = textareaRef.current;
      if (!textarea) return false;

      const sel: MdSelection = {
        value,
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
      };
      const next = transform(sel);
      if (
        next === null ||
        (next.value === value && next.start === sel.start && next.end === sel.end)
      ) {
        return false;
      }
      pendingSelectionRef.current = { start: next.start, end: next.end };
      onChange(next.value);
      return true;
    },
    [value, onChange],
  );

  const handleCommand = useCallback(
    (command: MarkdownCommand): void => {
      if (disabled) return;
      applyTransform((sel) => applyCommand(command, sel));
    },
    [disabled, applyTransform],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (disabled) return;

      // 1. Let the mention menu consume navigation keys first.
      if (mention.handleKeyDown(event)) return;

      const mod = event.metaKey || event.ctrlKey;

      // 2. Formatting shortcuts (only with the platform modifier held).
      if (mod && !event.altKey) {
        const key = event.key.toLowerCase();
        let command: MarkdownCommand | null = null;
        switch (key) {
          case "b":
            command = { type: "wrap", marker: "**" };
            break;
          case "i":
            command = { type: "wrap", marker: "_" };
            break;
          case "e":
            command = { type: "wrap", marker: "`" };
            break;
          case "k":
            command = { type: "link" };
            break;
        }
        if (command) {
          event.preventDefault();
          const cmd = command;
          applyTransform((sel) => applyCommand(cmd, sel));
          return;
        }
      }

      // 3. Plain Enter (no modifier, menu closed) continues / exits lists.
      // `handleListEnter` returns null off a list line, so applyTransform falls
      // through to the browser's native newline (preserving undo/IME); when it
      // does apply, we preventDefault to suppress the duplicate native newline.
      if (event.key === "Enter" && !mod && !event.shiftKey && !event.altKey) {
        if (applyTransform(handleListEnter)) {
          event.preventDefault();
        }
      }
    },
    [disabled, mention, applyTransform],
  );

  const hasContent = value.trim().length > 0;

  // A collapsible surface (the comment composer) must never sit in Preview with
  // nothing to preview — that happens when the user previews a draft, submits,
  // and the parent clears `value`; the stale "preview" mode would otherwise keep
  // the chrome open showing "Nothing to preview" instead of collapsing back to
  // the quiet input. We correct it by adjusting state *during render* (React's
  // documented pattern for deriving state from changed inputs), not in an effect:
  // React re-renders immediately without committing the intermediate tree, so
  // there is no Preview flash and no setState-in-effect cascade. Scoped to
  // `collapsible` so the always-chromed editor (task descriptions) keeps its
  // deliberate "Nothing to preview" placeholder.
  if (collapsible && mode === "preview" && !hasContent) {
    setMode("write");
  }

  // In collapsible mode the chrome (toolbar + Preview toggle) is revealed once
  // the user engages (focus) or there's already a draft to format/preview;
  // Preview mode always keeps the chrome so the user can switch back to Write.
  // When not collapsible the chrome is always present (description behaviour).
  const showChrome = !collapsible || focused || hasContent || mode === "preview";

  // One cohesive surface: the chrome row (toolbar in Write, label in Preview)
  // sits flush above the body, separated by a hairline border — not a gap — so
  // the toolbar reads as part of its input. The Write/Preview switch is folded
  // into the chrome as a single icon toggle (eye → preview, pencil → edit)
  // rather than a heavy top tab row, keeping the hierarchy: content first, then
  // the primary Save action (owned by the parent), then these quiet controls.
  return (
    <div
      className={cn(
        // NB: no `overflow-hidden` — it would clip the @mention dropdown that
        // spills below the textarea. The toolbar row rounds its own top corners
        // instead, so the surface still reads as one clean rounded card.
        "rounded-md border border-border-strong bg-surface-0 duration-fast",
        "focus-within:border-border-focus focus-within:ring-2 focus-within:ring-border-focus",
        disabled && "opacity-60",
      )}
    >
      {/* Chrome row: formatting toolbar (Write) or "Preview" label + mode toggle */}
      {showChrome && (
        <div className="flex items-center gap-r6 rounded-t-md border-b border-border-default bg-surface-1 px-r5 py-r6">
          {mode === "write" ? (
            <MarkdownToolbar onCommand={handleCommand} disabled={disabled} />
          ) : (
            <span className="px-r6 text-body-3 font-medium text-fg-secondary">Preview</span>
          )}

          <div className="ml-auto shrink-0 pl-r6">
            {mode === "write" ? (
              <IconButton
                type="button"
                aria-label="Preview"
                title="Preview"
                className="size-7 p-r6 text-fg-secondary hover:text-fg-primary"
                onClick={() => setMode("preview")}
                disabled={disabled}
              >
                <Eye size={16} aria-hidden="true" className="shrink-0" />
              </IconButton>
            ) : (
              <IconButton
                type="button"
                aria-label="Edit"
                title="Edit"
                className="size-7 p-r6 text-fg-secondary hover:text-fg-primary"
                onClick={() => setMode("write")}
              >
                <Pencil size={16} aria-hidden="true" className="shrink-0" />
              </IconButton>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      {mode === "write" ? (
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={mention.handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            disabled={disabled}
            rows={3}
            style={{ maxHeight: "20rem" }}
            className={cn(
              "md-editor__textarea block w-full resize-none overflow-y-auto bg-transparent px-r4 py-r5",
              "text-body-2 leading-relaxed text-fg-primary placeholder:text-fg-muted",
              "focus:outline-none disabled:cursor-not-allowed",
            )}
          />

          <MentionSuggestions
            open={mention.menuOpen}
            members={mention.filtered}
            activeIndex={mention.activeIndex}
            position={mention.menuPosition}
            menuRef={mention.menuRef}
            onActiveIndexChange={mention.setActiveIndex}
            onSelect={mention.insertMention}
          />
        </div>
      ) : (
        <div className="px-r4 py-r5">
          {hasContent ? (
            <Markdown density={density} members={members}>
              {value}
            </Markdown>
          ) : (
            <p className="text-body-3 text-fg-muted">Nothing to preview</p>
          )}
        </div>
      )}
    </div>
  );
}

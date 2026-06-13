import {
  Bold,
  Code,
  Heading,
  Italic,
  Link,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  Quote,
  SquareCode,
} from "lucide-react";
import { type MouseEvent } from "react";

import { IconButton } from "@/web/components/ui/IconButton";

/**
 * Commands emitted by the toolbar. The toolbar is purely presentational: it
 * renders buttons and reports the user's intent as one of these tagged unions.
 * The `MarkdownEditor` (built later) owns the live textarea selection and maps
 * each command onto the matching pure transform in `transforms.ts`
 * (`wrap` → `wrapInline`, `heading` → `toggleHeading`, etc.). Keeping the
 * toolbar free of selection/DOM coupling is what lets the transforms stay a
 * fully-unit-testable single source of truth — see swarm/plans/markdown.md §4.
 */
export type MarkdownCommand =
  | { type: "wrap"; marker: "**" | "_" | "`" } // bold / italic / inline-code
  | { type: "heading" } // toggle heading on current line
  | { type: "blockquote" }
  | { type: "list"; ordered: boolean }
  | { type: "link" }
  | { type: "codeblock" }
  | { type: "hr" };

/**
 * One declarative button definition. Grouping the metadata in an array (rather
 * than hand-writing ten near-identical JSX buttons) keeps the ordering, labels,
 * and command payloads in a single readable table and makes the focus-preserving
 * mouse handling impossible to forget on any one button.
 */
interface ToolbarButton {
  /** Stable key + screen-reader label + native tooltip text. */
  label: string;
  icon: LucideIcon;
  command: MarkdownCommand;
}

/**
 * Buttons are grouped by purpose with subtle separators between groups:
 *   1. inline emphasis (bold / italic / inline code)
 *   2. block structure (heading / quote / lists)
 *   3. insertions (code block / link / horizontal rule)
 */
const BUTTON_GROUPS: ToolbarButton[][] = [
  [
    { label: "Bold", icon: Bold, command: { type: "wrap", marker: "**" } },
    { label: "Italic", icon: Italic, command: { type: "wrap", marker: "_" } },
    { label: "Inline code", icon: Code, command: { type: "wrap", marker: "`" } },
  ],
  [
    { label: "Heading", icon: Heading, command: { type: "heading" } },
    { label: "Quote", icon: Quote, command: { type: "blockquote" } },
    { label: "Bulleted list", icon: List, command: { type: "list", ordered: false } },
    { label: "Numbered list", icon: ListOrdered, command: { type: "list", ordered: true } },
  ],
  [
    { label: "Code block", icon: SquareCode, command: { type: "codeblock" } },
    { label: "Link", icon: Link, command: { type: "link" } },
    { label: "Divider", icon: Minus, command: { type: "hr" } },
  ],
];

/**
 * Compact formatting toolbar for the markdown editor.
 *
 * Presentational only: it never touches the textarea. Each button reports its
 * intent via `onCommand`; the editor applies the actual string transform so the
 * stored markdown stays the canonical format end-to-end.
 *
 * **Why `onMouseDown` preventDefault:** a toolbar button stealing focus would
 * collapse the textarea's selection before the command runs, so a "Bold" click
 * would wrap nothing. Calling `preventDefault()` on mousedown stops the button
 * from becoming the active element, leaving the textarea focused with its
 * selection intact; the command then fires on `click`. The button is still
 * fully keyboard-operable (Tab to focus, Enter/Space to activate) because
 * preventing the *mousedown* default does not block keyboard activation.
 */
export function MarkdownToolbar(props: {
  onCommand: (command: MarkdownCommand) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { onCommand, disabled } = props;

  // Preserve the textarea's focus/selection: stop the button grabbing focus on
  // press. The actual command is dispatched on `click` (below) so the textarea
  // is still the active element when the editor reads its selection.
  const preserveFocus = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <div
      className="flex flex-wrap items-center gap-r6"
      role="toolbar"
      aria-label="Formatting"
    >
      {BUTTON_GROUPS.map((group, groupIndex) => (
        <div key={group[0].label} className="flex items-center gap-r6">
          {groupIndex > 0 && (
            <div className="mr-r6 h-5 w-px shrink-0 bg-border-default" aria-hidden="true" />
          )}
          {group.map(({ label, icon: Icon, command }) => (
            <IconButton
              key={label}
              type="button"
              aria-label={label}
              title={label}
              disabled={disabled}
              className="size-7 p-r6 text-fg-primary"
              onMouseDown={preserveFocus}
              onClick={() => onCommand(command)}
            >
              <Icon size={16} aria-hidden="true" className="shrink-0" />
            </IconButton>
          ))}
        </div>
      ))}
    </div>
  );
}

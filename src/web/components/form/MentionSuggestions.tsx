import { type RefObject } from "react";

import { Avatar } from "@/web/components/ui/Avatar";
import { Text } from "@/web/components/ui/Text";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { cn } from "@/web/util/style/style";

export interface MentionSuggestionsProps {
  /** Whether the dropdown should render. */
  open: boolean;
  /** Members to display, in order. */
  members: WorkspaceMember[];
  /** Index of the highlighted member. */
  activeIndex: number;
  /** Absolute pixel position relative to the positioned wrapper. */
  position: { top: number; left: number };
  /** Ref for outside-click detection (wire to `useMentionAutocomplete`). */
  menuRef: RefObject<HTMLDivElement | null>;
  /** Highlight a member (e.g. on hover). */
  onActiveIndexChange: (index: number) => void;
  /** Commit a member as a mention. */
  onSelect: (member: WorkspaceMember) => void;
}

/**
 * Presentational dropdown for `@mention` autocomplete: an absolutely-positioned
 * listbox of workspace members (avatar + name + email).
 *
 * Kept as a standalone component so every `MarkdownEditor` instance (task
 * descriptions and the comment composer/edit form alike) renders an identical
 * menu — the markup, ARIA roles, and styling live in one place, paired with the
 * `useMentionAutocomplete` hook that drives it.
 *
 * `onMouseDown` is preventDefault-ed on each option so clicking a suggestion
 * doesn't blur the textarea before the insertion runs.
 */
export function MentionSuggestions({
  open,
  members,
  activeIndex,
  position,
  menuRef,
  onActiveIndexChange,
  onSelect,
}: MentionSuggestionsProps) {
  if (!open || members.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className={cn(
        "absolute z-50 min-w-[12.5rem] max-w-[17.5rem] max-h-[12.5rem] overflow-y-auto",
        "bg-surface-0 border border-border-default rounded-lg shadow-lg",
        "py-1",
      )}
      style={{
        top: position.top,
        left: position.left,
      }}
      role="listbox"
      aria-label="Mention suggestions"
    >
      {members.map((member, index) => (
        <button
          key={member.userId}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={cn(
            "flex items-center gap-2 w-full px-3 py-1.5 text-left",
            "transition-colors duration-fast",
            index === activeIndex
              ? "bg-surface-2 text-fg-primary"
              : "text-fg-secondary hover:bg-surface-1",
          )}
          onMouseEnter={() => onActiveIndexChange(index)}
          onMouseDown={(e) => {
            e.preventDefault(); // prevent textarea blur
            onSelect(member);
          }}
        >
          <Avatar size="xs" name={member.user.name} src={member.user.image} />
          <div className="min-w-0 flex-1">
            <Text variant="body-2" className="truncate">
              {member.user.name}
            </Text>
            <Text variant="body-3" color="muted" className="truncate">
              {member.user.email}
            </Text>
          </div>
        </button>
      ))}
    </div>
  );
}

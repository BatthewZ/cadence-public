import {
  type ChangeEvent,
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { Avatar } from "@/web/components/ui/Avatar";
import { Text } from "@/web/components/ui/Text";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { cn } from "@/web/util/style/style";

import { Textarea } from "./Textarea";

/* ------------------------------------------------------------------ */
/*  Caret coordinate calculation                                       */
/* ------------------------------------------------------------------ */

const MIRROR_STYLE_PROPS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "wordSpacing",
  "textIndent",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "boxSizing",
] as const;

function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): { top: number; left: number } {
  const mirror = document.createElement("div");
  const computed = getComputedStyle(textarea);

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflow = "hidden";
  mirror.style.width = computed.width;

  for (const prop of MIRROR_STYLE_PROPS) {
    mirror.style[prop] = computed[prop];
  }

  const textBefore = textarea.value.substring(0, position);
  const textNode = document.createTextNode(textBefore);
  mirror.appendChild(textNode);

  const marker = document.createElement("span");
  marker.textContent = "\u200b"; // zero-width space
  mirror.appendChild(marker);

  document.body.appendChild(mirror);

  const top = marker.offsetTop - textarea.scrollTop;
  const left = marker.offsetLeft;

  document.body.removeChild(mirror);

  return { top, left };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  members: WorkspaceMember[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(
  function MentionTextarea({ value, onChange, members, placeholder, className, disabled }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => textareaRef.current!);

    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const [mentionStart, setMentionStart] = useState(-1);
    const menuRef = useRef<HTMLDivElement>(null);

    const filtered = useMemo(
      () => members.filter((m) => m.user.name.toLowerCase().includes(query.toLowerCase())),
      [members, query],
    );

    const closeMention = useCallback(() => {
      setMenuOpen(false);
      setQuery("");
      setMentionStart(-1);
    }, []);

    // Close menu on outside click
    useEffect(() => {
      if (!menuOpen) return;
      function handleClick(e: MouseEvent) {
        if (
          menuRef.current &&
          !menuRef.current.contains(e.target as Node) &&
          textareaRef.current &&
          !textareaRef.current.contains(e.target as Node)
        ) {
          closeMention();
        }
      }
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, [menuOpen, closeMention]);

    function insertMention(member: WorkspaceMember) {
      const textarea = textareaRef.current;
      if (!textarea || mentionStart < 0) return;

      const name = member.user.name;
      // Use quotes if name contains spaces
      const mention = name.includes(" ") ? `@"${name}" ` : `@${name} `;
      const before = value.substring(0, mentionStart);
      const after = value.substring(textarea.selectionStart);
      const newValue = before + mention + after;

      onChange(newValue);
      closeMention();

      // Restore cursor position after the inserted mention
      requestAnimationFrame(() => {
        const cursorPos = before.length + mention.length;
        textarea.focus();
        textarea.setSelectionRange(cursorPos, cursorPos);
      });
    }

    function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
      const newValue = e.target.value;
      onChange(newValue);

      const textarea = e.target;
      const cursorPos = textarea.selectionStart;

      // Find the @ trigger before cursor
      const textBeforeCursor = newValue.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");

      if (lastAtIndex === -1) {
        closeMention();
        return;
      }

      // Check that there's no space between @ and cursor that would break the mention
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);

      // Allow spaces in the query (for multi-word name matching)
      // but close if there's a newline or the query is too long
      if (textAfterAt.includes("\n") || textAfterAt.length > 30) {
        closeMention();
        return;
      }

      // @ must be at start of text or preceded by whitespace
      if (lastAtIndex > 0 && !/\s/.test(newValue[lastAtIndex - 1])) {
        closeMention();
        return;
      }

      const currentQuery = textAfterAt;

      // Check if any members match
      const hasMatches = members.some((m) =>
        m.user.name.toLowerCase().includes(currentQuery.toLowerCase()),
      );

      if (hasMatches && currentQuery.length >= 0) {
        setMentionStart(lastAtIndex);
        if (currentQuery !== query) setActiveIndex(0);
        setQuery(currentQuery);
        setMenuOpen(true);

        // Position the dropdown
        const coords = getCaretCoordinates(textarea, lastAtIndex);
        setMenuPosition({
          top: coords.top + parseInt(getComputedStyle(textarea).lineHeight || "20"),
          left: coords.left,
        });
      } else {
        closeMention();
      }
    }

    function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
      if (!menuOpen || filtered.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % filtered.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          insertMention(filtered[activeIndex]);
          break;
        case "Escape":
          e.preventDefault();
          closeMention();
          break;
      }
    }

    return (
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={className}
          disabled={disabled}
        />

        {menuOpen && filtered.length > 0 && (
          <div
            ref={menuRef}
            className={cn(
              "absolute z-50 min-w-[200px] max-w-[280px] max-h-[200px] overflow-y-auto",
              "bg-surface-0 border border-border-default rounded-lg shadow-lg",
              "py-1",
            )}
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
            }}
            role="listbox"
            aria-label="Mention suggestions"
          >
            {filtered.map((member, index) => (
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
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent textarea blur
                  insertMention(member);
                }}
              >
                <Avatar size="xs" name={member.user.name} src={member.user.image} />
                <div className="min-w-0 flex-1">
                  <Text variant="body-2" className="truncate">{member.user.name}</Text>
                  <Text variant="body-3" color="muted" className="truncate">{member.user.email}</Text>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);

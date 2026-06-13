import {
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";

/* ------------------------------------------------------------------ */
/*  Caret coordinate calculation                                       */
/* ------------------------------------------------------------------ */

/**
 * Style properties mirrored onto the off-screen measuring `<div>` so the
 * mirror wraps text identically to the real textarea. Getting the caret's
 * pixel position requires reproducing the textarea's box model exactly —
 * font metrics, padding, and borders all shift where a character lands.
 */
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

/**
 * Compute the pixel coordinates of a caret position inside a textarea.
 *
 * The DOM exposes no direct API for this, so we build a hidden mirror `<div>`
 * that copies the textarea's typographic styles, insert the text up to
 * `position`, then read the offset of a zero-width marker span. This is the
 * standard "caret mirror" technique and is what lets the mention dropdown
 * appear directly beneath the `@` the user just typed.
 */
function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): { top: number; left: number } {
  const mirror = document.createElement("div");
  const computed = getComputedStyle(textarea);

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.overflow = "hidden";
  mirror.style.width = computed.width;

  for (const prop of MIRROR_STYLE_PROPS) {
    mirror.style[prop] = computed[prop];
  }

  const textBefore = textarea.value.substring(0, position);
  const textNode = document.createTextNode(textBefore);
  mirror.appendChild(textNode);

  const marker = document.createElement("span");
  marker.textContent = "​"; // zero-width space
  mirror.appendChild(marker);

  document.body.appendChild(mirror);

  const top = marker.offsetTop - textarea.scrollTop;
  const left = marker.offsetLeft;

  document.body.removeChild(mirror);

  return { top, left };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UseMentionAutocompleteOptions {
  /** Ref to the textarea the mention autocomplete is attached to. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Current textarea value (controlled). */
  value: string;
  /** Propagate a new value to the controlling component. */
  onChange: (value: string) => void;
  /** Workspace members offered as mention candidates. */
  members: WorkspaceMember[];
}

export interface UseMentionAutocompleteResult {
  /** Whether the suggestion dropdown is currently open. */
  menuOpen: boolean;
  /** Absolute pixel position of the dropdown relative to the wrapper. */
  menuPosition: { top: number; left: number };
  /** Members matching the current query, in display order. */
  filtered: WorkspaceMember[];
  /** Index of the currently highlighted suggestion. */
  activeIndex: number;
  /** Highlight a suggestion (e.g. on hover). */
  setActiveIndex: (index: number) => void;
  /** Ref to attach to the dropdown container (used for outside-click close). */
  menuRef: RefObject<HTMLDivElement | null>;
  /** Insert the given member as a mention at the active `@` trigger. */
  insertMention: (member: WorkspaceMember) => void;
  /** Call from the textarea's `onChange` AFTER propagating the value. */
  handleChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  /**
   * Call from the textarea's `onKeyDown`. Returns `true` if the key was
   * consumed for menu navigation/selection (the caller must then not act on
   * it — e.g. don't submit on Enter while the menu is open).
   */
  handleKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

/**
 * Reusable `@mention` autocomplete behaviour for a `<textarea>`.
 *
 * This is the single source of truth for mention triggering, caret-anchored
 * dropdown positioning, keyboard navigation, and `@"Name"` quoting. It is
 * consumed by `MarkdownEditor`, which is the one authoring surface behind every
 * mention-aware input (task descriptions and the comment composer/edit form),
 * so all of them behave identically (project rule: single source of truth, no
 * adapters).
 *
 * The trigger rules are deliberately strict: the `@` must sit at the start of
 * the text or immediately after whitespace (so emails like `a@b` never open
 * the menu), spaces are permitted inside the query for multi-word name
 * matching, and the menu closes on a newline, an over-long query, or when no
 * member matches.
 */
export function useMentionAutocomplete({
  textareaRef,
  value,
  onChange,
  members,
}: UseMentionAutocompleteOptions): UseMentionAutocompleteResult {
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

  // Close menu on outside click (ignoring clicks within the menu or textarea).
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
  }, [menuOpen, closeMention, textareaRef]);

  const insertMention = useCallback(
    (member: WorkspaceMember) => {
      const textarea = textareaRef.current;
      if (!textarea || mentionStart < 0) return;

      const name = member.user.name;
      // Quote names that contain spaces so the mention parses back as one token.
      const mention = name.includes(" ") ? `@"${name}" ` : `@${name} `;
      const before = value.substring(0, mentionStart);
      const after = value.substring(textarea.selectionStart);
      const newValue = before + mention + after;

      onChange(newValue);
      closeMention();

      // Restore cursor position after the inserted mention.
      requestAnimationFrame(() => {
        const cursorPos = before.length + mention.length;
        textarea.focus();
        textarea.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [textareaRef, mentionStart, value, onChange, closeMention],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      const textarea = e.target;
      const cursorPos = textarea.selectionStart;

      // Find the @ trigger before the cursor.
      const textBeforeCursor = newValue.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");

      if (lastAtIndex === -1) {
        closeMention();
        return;
      }

      // Text between the @ and the cursor is the live query.
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);

      // Allow spaces in the query (for multi-word name matching) but close if
      // there's a newline or the query is too long.
      if (textAfterAt.includes("\n") || textAfterAt.length > 30) {
        closeMention();
        return;
      }

      // @ must be at start of text or preceded by whitespace.
      if (lastAtIndex > 0 && !/\s/.test(newValue[lastAtIndex - 1])) {
        closeMention();
        return;
      }

      const currentQuery = textAfterAt;

      // Check if any members match.
      const hasMatches = members.some((m) =>
        m.user.name.toLowerCase().includes(currentQuery.toLowerCase()),
      );

      if (hasMatches && currentQuery.length >= 0) {
        setMentionStart(lastAtIndex);
        if (currentQuery !== query) setActiveIndex(0);
        setQuery(currentQuery);
        setMenuOpen(true);

        // Position the dropdown beneath the @ trigger. Clamp `left` so the menu
        // (max width ~17.5rem ≈ 280px, see MentionSuggestions) never extends
        // past the textarea's right edge — otherwise a caret near the end of a
        // line would push the absolutely-positioned menu out of the editor and
        // force the whole sidebar to scroll horizontally.
        const MENU_WIDTH = 280;
        const coords = getCaretCoordinates(textarea, lastAtIndex);
        const maxLeft = Math.max(0, textarea.clientWidth - MENU_WIDTH);
        setMenuPosition({
          top: coords.top + parseInt(getComputedStyle(textarea).lineHeight || "20"),
          left: Math.min(coords.left, maxLeft),
        });
      } else {
        closeMention();
      }
    },
    [onChange, members, query, closeMention],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!menuOpen || filtered.length === 0) return false;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % filtered.length);
          return true;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
          return true;
        case "Enter":
        case "Tab":
          e.preventDefault();
          insertMention(filtered[activeIndex]);
          return true;
        case "Escape":
          e.preventDefault();
          closeMention();
          return true;
        default:
          return false;
      }
    },
    [menuOpen, filtered, activeIndex, insertMention, closeMention],
  );

  return {
    menuOpen,
    menuPosition,
    filtered,
    activeIndex,
    setActiveIndex,
    menuRef,
    insertMention,
    handleChange,
    handleKeyDown,
  };
}

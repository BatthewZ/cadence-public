# Markdown

A lite-Markdown **renderer** and **editor** that gives task descriptions and comments rich formatting **without changing the stored format**. Markdown stays the canonical string end-to-end — the DB `text` column, the `z.string().max(5000)` validation, webhooks, export/import, PATs, and activity diffs all keep operating on the same plain string. Markdown is only how that string is *authored and displayed*.

**Source:** `src/web/components/markdown/` (barrel: `index.ts`)

| File | Role |
| --- | --- |
| `parse.ts` | Pure markdown-subset tokenizer → AST (`MdNode` / `MdInline`). Exports `parseMarkdown`. |
| `Markdown.tsx` | Renderer — walks the AST and emits React elements directly (no HTML string). |
| `transforms.ts` | Pure selection transforms (`wrapInline`, `toggleHeading`, `toggleList`, …) for the toolbar + shortcuts. |
| `MarkdownToolbar.tsx` | Presentational toolbar that emits `MarkdownCommand`. |
| `MarkdownEditor.tsx` | `<textarea>` + toolbar + Write/Preview tabs + mention autocomplete + keyboard shortcuts. |
| `EditableMarkdown.tsx` | Click-to-edit wrapper with explicit Save/Cancel. |
| `src/web/hooks/use-mention-autocomplete.ts` | Shared `@mention` autocomplete (caret-mirror dropdown positioning + keyboard nav). |
| `src/web/components/form/MentionSuggestions.tsx` | Shared mention dropdown markup. |
| `src/web/style/components/markdown.css` | `.md` prose typography scale + `.md--compact` density. |

---

## Why this design

### Markdown-as-canonical-string (no format change)

The stored value never changes shape: it is the same plain markdown string it always was. That is the single most important property of the feature, because *everything downstream already operates on that string and keeps working untouched* — webhook payloads, workspace JSON/CSV export and import, PAT-authored content, and activity-diff text are all unchanged. Markdown is layered on purely at author/display time.

This also keeps the door open for a future WYSIWYG swap: TipTap (or similar) could replace **the editor only** without any data migration, because the persisted format is already the lowest common denominator. We deliberately use a `<textarea>` — not `contenteditable` — so selection, IME composition, and native undo stay browser-native and bug-free today.

### The renderer emits React elements directly (XSS-safe by construction)

`Markdown.tsx` never builds an HTML string and never calls `dangerouslySetInnerHTML`. It walks the AST and returns real React elements (`<strong>`, `<a>`, `<code>`, …). Because no HTML string ever exists, there is **no injection surface to sanitize** — the renderer cannot emit a `<script>` or an event-handler attribute even if the source string contains one; that text simply becomes a literal text node. This removes the need for a DOMPurify-style dependency entirely: safety is a property of the construction, not of a sanitizer pass that could be misconfigured or skipped.

Link protocols are still allow-listed as defence-in-depth: only `http:`, `https:`, and `mailto:` produce an anchor. Any other scheme (notably `javascript:` and `data:`) renders the link **text as plain inline content with no anchor at all** — strictly safer than an inert `#` href. Every emitted anchor carries `target="_blank" rel="noopener noreferrer"`.

### A separate prose typography scale + compact density

The global `@layer base` (`src/web/style/responsive/text.css`) styles bare `h1`–`h6` on a **display** scale — `h1` is `4rem` on desktop. That is correct for hero/landing headings but absurd for an `# Heading` inside a 380px task sidebar. The markdown renderer emits *real* `<h1>`–`<h6>`, so un-scoped they would inherit that display size.

`src/web/style/components/markdown.css` fixes this by scoping a **content** scale under `.md`. The `.md h1` selector beats the base `h1` on specificity *and* loads later (this file imports after `responsive/`), so the content scale wins. Heading sizes are exposed as `.md`-scoped custom properties, so the `.md--compact` modifier only overrides the variables rather than re-declaring each rule.

| | comfortable (`.md`) | compact (`.md--compact`) |
| --- | --- | --- |
| h1 | 1.5rem | 1.125rem |
| h2 | 1.25rem | 1rem |
| h3 | 1.125rem | 0.9375rem |
| h4 | 1rem | 0.875rem |
| h5 / h6 | 0.9375 / 0.875rem | 0.875 / 0.8125rem |
| body | `--BodyText-2` | `--BodyText-3` |

Element styling pulls existing design tokens: code → `--C-SURFACE-2` + `--DEFAULT-MONO-FONT`; blockquote → a `--C-BORDER-STRONG` left rule + `--C-TEXT-SECONDARY`; `hr` → `--C-BORDER-DEFAULT`; links → `--C-ACCENT`. Block spacing is handled by `.md > * + *` using the `--R-SIZE-*` rhythm tokens. `overflow-wrap: anywhere` keeps long URLs and mention tokens from blowing out the container.

### One shared `useMentionAutocomplete` hook (single source of truth)

`@mention` logic — the `@` trigger rules, the caret-mirror dropdown positioning, keyboard navigation, and `@"Name"` quoting — lives in exactly one place: `src/web/hooks/use-mention-autocomplete.ts`, paired with the `MentionSuggestions` dropdown. `MarkdownEditor` consumes it and is the single authoring surface behind every mention-aware input — task descriptions, the comment composer, and the comment edit form — so those surfaces can never drift apart (CLAUDE.md rule 4 — single source of truth, no adapters). The old standalone `MentionTextarea` comment box was retired once the composer moved to `MarkdownEditor`. The mention **rendering** path is unified too: the old `MentionText` component was deleted and its highlight markup absorbed into the `Markdown` renderer's `mention` AST node, which emits the same pixel-identical badge span.

---

## Supported subset (v1)

**Blocks:** headings `#`–`######`, paragraphs (wrapped lines reflow), blockquote `> ` (one level, inline content, consecutive `>` lines joined), horizontal rule `---`, fenced code block ` ``` ` (info string ignored, content never inline-parsed), unordered list `- ` / `* `, ordered list `1. `.

**Inline:** bold `**…**`, italic `_…_` / `*…*`, bold-italic `***…***`, **one level of nesting** (`**a _b_ c**`), inline code `` `…` `` (atomic — its content is never re-parsed), link `[text](url)` (href protocol allow-listed; paren-balanced so URLs containing `()` close correctly), mention `@"Name"` / `@username`.

**Graceful degradation:** anything unsupported — GFM tables from a PAT client, a Trello import, an unterminated `**`, a `javascript:` link — degrades to **literal text** and never throws. The parser is built so the tokenizer always makes forward progress (no infinite loop on malformed input), and emphasis stops nesting past one level so pathological input can't recurse without bound. Mentions are not parsed inside code spans or code blocks.

---

## Component APIs

### `Markdown` — renderer

```tsx
import { Markdown } from "@/web/components/markdown/Markdown";

<Markdown density="compact" members={members}>
  {task.description}
</Markdown>
```

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `string` | Raw, stored markdown string (the canonical format). |
| `members` | `WorkspaceMember[]` *(optional)* | Accepted for API symmetry and future mention resolution. Mention AST nodes already carry their display `name`, so rendering does not require it today. |
| `density` | `"comfortable" \| "compact"` | Default `comfortable`. Sidebar / inline contexts pass `compact` for the tighter prose scale. |
| `className` | `string` *(optional)* | Merged onto the root `.md` wrapper via `cn()`. |

### `MarkdownEditor` — textarea + toolbar + Write/Preview

```tsx
import { MarkdownEditor } from "@/web/components/markdown/MarkdownEditor";

<MarkdownEditor value={draft} onChange={setDraft} members={members} autoFocus />
```

| Prop | Type | Description |
| --- | --- | --- |
| `value` | `string` | Controlled markdown string. |
| `onChange` | `(value: string) => void` | Receives the updated markdown string. |
| `members` | `WorkspaceMember[]` *(optional)* | Enables `@mention` autocomplete when provided. |
| `placeholder` | `string` *(optional)* | Textarea placeholder. |
| `disabled` | `boolean` *(optional)* | Disables editing and toolbar. |
| `autoFocus` | `boolean` *(optional)* | Focuses the textarea once on mount. |
| `density` | `"comfortable" \| "compact"` *(optional)* | Density passed through to the Preview render. |
| `collapsible` | `boolean` *(optional)* | Progressive disclosure for low-friction surfaces (the comment composer). The toolbar / Preview chrome stays hidden until the textarea is focused or already holds content — an empty input reads as one quiet line, then reveals the full editor on engage. The **same** textarea stays mounted across the transition (only the chrome row's visibility toggles), so there is no remount, focus loss, or caret jump. Default `false` (chrome always shown, as for task descriptions). |

**Toolbar & shortcuts.** Bold (⌘/Ctrl+B), italic (⌘/Ctrl+I), inline code (⌘/Ctrl+E), link (⌘/Ctrl+K), plus quote, heading, bulleted/numbered list, code block, and horizontal rule buttons. Plain **Enter** continues a list (next number for ordered lists) and exits the list on an empty item; off a list line it falls through to the browser's native newline so undo/IME stay intact. Toolbar buttons `preventDefault` their mousedown so they never steal the textarea's selection before the command runs.

**Caret restoration.** The textarea is controlled, so a transform applies via `onChange` and the new value only lands after a parent re-render. The editor stashes the post-transform `[start, end]` range in a ref and reapplies it in a `useLayoutEffect` keyed on `value` — after React commits but before paint — so the caret never visibly jumps.

### `EditableMarkdown` — click-to-edit wrapper

```tsx
import { EditableMarkdown } from "@/web/components/markdown/EditableMarkdown";

<EditableMarkdown
  value={task.description ?? ""}
  density="compact"
  members={members}
  readOnly={!canEditTasks}
  onSave={(next) => handlePatch({ description: next || null })}
/>
```

| Prop | Type | Description |
| --- | --- | --- |
| `value` | `string` | Raw, stored markdown string. |
| `onSave` | `(next: string) => Promise<void>` | Persists the edit. Resolve → exit to view mode; reject → stay in edit mode with the draft intact so the user can retry. |
| `members` | `WorkspaceMember[]` *(optional)* | Mention resolution in both render and editor. |
| `readOnly` | `boolean` *(optional)* | Renders plain prose with no edit affordance. |
| `density` | `"comfortable" \| "compact"` *(optional)* | Prose scale. |
| `placeholder` | `string` *(optional)* | Muted prompt shown when `value` is empty/whitespace (default `"Add a description…"`). |

**Click-to-edit Save/Cancel UX (decision locked).** View mode renders `<Markdown>` inside a `role="button"` surface — click, Enter, or Space enters edit mode (when not `readOnly`). Edit mode shows `<MarkdownEditor>` plus an explicit Save / Cancel footer. **Clicking away keeps editing.** Long-form authoring routinely loses focus — clicking the toolbar, opening the mention dropdown, tabbing to a button, or an IME commit all blur the textarea — so a blur-to-save or click-outside-to-close handler would silently end the edit mid-thought (a classic data-loss footgun). The component has **neither**; the only ways out of edit mode are **Save**, **Cancel**, **⌘/Ctrl+Enter** (save), or **Esc** (cancel).

The draft is seeded from `value` only when *entering* edit mode, so a background refetch that changes `value` mid-edit never clobbers unsaved typing (mirrors the dirty-field guard in `use-task-editing.ts`). The parent owns persistence and error toasts; the draft is passed through unmodified (no trimming) so the parent decides empty/null handling.

---

## AST contract

`parseMarkdown(src)` is a pure function (no React, no DOM) that scans in two phases — block scan by line, then inline tokenize each text run — so block context (e.g. "inside a fenced code block") can fully suppress inline parsing.

```ts
export type MdInline =
  | { type: "text"; value: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "code"; value: string }            // atomic, no children
  | { type: "link"; href: string; children: MdInline[] }
  | { type: "mention"; name: string };

export type MdNode =
  | { type: "heading"; level: 1|2|3|4|5|6; children: MdInline[] }
  | { type: "paragraph"; children: MdInline[] }
  | { type: "blockquote"; children: MdInline[] }   // consecutive `>` lines joined
  | { type: "code_block"; text: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: MdInline[][] };

export function parseMarkdown(src: string): MdNode[];
```

The parser captures the link `href` **raw** — protocol safety is the renderer's job, so a `javascript:` URL still produces a `link` node here and is neutralised downstream in `Markdown.tsx`. The renderer's `switch` over both `MdInline` and `MdNode` is exhaustive, so adding a new AST variant surfaces as a TypeScript error at the render site rather than a silent no-op.

---

## Integrations

- **Task description** — `TaskDetailPanelInner.tsx` and `TaskDetailDialog.tsx` render the description via `<EditableMarkdown density="compact" members={members} readOnly={!canEditTasks}>`, saving through `handlePatch({ description: next || null })`. Blur-to-save was removed in favour of the explicit Save/Cancel flow.
- **Comments** — comment **display** uses `<Markdown density="compact" members={members}>` (`TaskCommentSection.tsx`); both comment **authoring** surfaces use `<MarkdownEditor density="compact" members={members}>` — the new-comment composer passes `collapsible` (progressive disclosure: it reads as a single quiet input until focused, then reveals the toolbar / Preview chrome with the same textarea still mounted, so there is no focus loss or caret jump), while the in-place edit form uses the full editor with `autoFocus`. Comments thus get the exact same toolbar, shortcuts, and `@mention` autocomplete as task descriptions, and still round-trip through the same canonical markdown string they were already rendered from — no DB, webhook, or export change.
- **Mention rendering** — the deleted `MentionText` component is replaced entirely by the `Markdown` renderer's `mention` node.

---

## Deferred / not in v1

| Feature | Why deferred |
| --- | --- |
| Task-list checkboxes (`- [ ]`) | Needs a write-back path (toggling a checkbox must edit the source string and persist), which is a richer interaction than read-only rendering. |
| Tables | High parsing + layout cost for a content surface where they're rare; degrade cleanly to literal text until needed. |
| Images | Raises hosting, sizing, and untrusted-URL concerns that warrant their own design pass (the CSS already has a defensive `.md img` rule for when they land). |
| Raw / inline HTML | Intentionally unsupported — the whole point of emitting React elements directly is that no HTML string is ever interpreted, which is what makes the renderer XSS-safe by construction. Allowing raw HTML would reintroduce the injection surface we removed. |

---

## Dependencies

- [`Textarea`](forms.md#textarea), [`IconButton`](icon-button.md), [`Button`](button.md)
- [`MentionSuggestions`](#) — shared mention dropdown (`src/web/components/form/MentionSuggestions.tsx`)
- [`useMentionAutocomplete`](hooks.md) — shared `@mention` autocomplete hook
- Design tokens via `src/web/style/components/markdown.css`
- `lucide-react` icons (toolbar)

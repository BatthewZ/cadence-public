# MentionText (removed)

> **This component no longer exists.** `src/web/components/ui/MentionText.tsx` was deleted when the markdown feature shipped. `@mention` syntax is now handled in two places, both single sources of truth:
>
> - **Rendering** — the `mention` AST node in the [Markdown renderer](markdown.md) emits the same styled inline badge that `MentionText` used to. Anywhere a comment or description is *displayed*, use [`<Markdown>`](markdown.md#markdown--renderer).
> - **Authoring autocomplete** — the `@` trigger, caret-anchored dropdown, keyboard navigation, and `@"Name"` quoting live in the shared [`useMentionAutocomplete`](hooks.md) hook (`src/web/hooks/use-mention-autocomplete.ts`) plus the `MentionSuggestions` dropdown, consumed by `MarkdownEditor` — the single authoring surface behind task descriptions and the comment composer/edit form alike.

## Migration

| Old usage | New usage |
| --- | --- |
| `<MentionText>{body}</MentionText>` (display) | `<Markdown density="compact" members={members}>{body}</Markdown>` |
| Mention regex / highlight logic | `parseMarkdown` + the `mention` AST node (see [markdown.md](markdown.md#ast-contract)) |
| Mention autocomplete in a textarea | [`MarkdownEditor`](markdown.md#markdowneditor--textarea--toolbar--writepreview) (wraps [`useMentionAutocomplete`](hooks.md) + `MentionSuggestions`) |

See [Markdown](markdown.md) for the full renderer/editor documentation, including why mention rendering and autocomplete were each unified into a single source of truth.

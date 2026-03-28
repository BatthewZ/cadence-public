# MentionText

Renders `@mention` syntax within a text string as styled inline badges. Plain text is passed through unchanged; `@name` and `@"name with spaces"` patterns are highlighted with a primary-tinted background.

**Source:** `src/web/components/ui/MentionText.tsx`

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `string` | The text content to parse for `@mention` patterns. |

## Mention Syntax

Matches two patterns via regex:

| Pattern | Example | Extracted name |
| --- | --- | --- |
| `@word` | `@alice` | `alice` |
| `@"quoted name"` | `@"Alice Smith"` | `Alice Smith` |

## Rendering

- Text between mentions is rendered as plain text nodes.
- Each mention is wrapped in a `<span>` with classes: `inline-flex items-center rounded px-1 py-0.5 text-fg-primary bg-primary/10 font-medium`.
- If no mentions are found, the original string is returned as-is.

## Usage

```tsx
import { MentionText } from "@/web/components/ui/MentionText";

<Text variant="body-2">
  <MentionText>{"Hello @alice and @\"Bob Smith\", check this out"}</MentionText>
</Text>
```

## Where Used

- **TaskDetailDialog** — comment body rendering.
- **TaskDetailPanel** — comment body rendering.

## Dependencies

None (pure React, no external dependencies).

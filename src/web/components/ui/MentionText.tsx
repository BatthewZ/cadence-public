import { type ReactNode } from "react";

const MENTION_REGEX = /@"([^"]+)"|@(\w+)/g;

interface MentionTextProps {
  children: string;
}

export function MentionText({ children }: MentionTextProps) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(MENTION_REGEX.source, "g");

  while ((match = regex.exec(children)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(children.slice(lastIndex, match.index));
    }

    const mentionName = match[1] ?? match[2];
    parts.push(
      <span
        key={match.index}
        className="inline-flex items-center rounded px-1 py-0.5 text-fg-primary bg-primary/10 font-medium"
      >
        @{mentionName}
      </span>
    );

    lastIndex = regex.lastIndex;
  }

  // If no mentions found, return plain text
  if (parts.length === 0) {
    return <>{children}</>;
  }

  // Add remaining text after last match
  if (lastIndex < children.length) {
    parts.push(children.slice(lastIndex));
  }

  return <span>{parts}</span>;
}

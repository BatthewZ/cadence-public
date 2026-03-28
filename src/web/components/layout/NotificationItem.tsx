import type { ReactNode } from "react";

import { Avatar } from "@/web/components/ui/Avatar";

interface NotificationItemProps {
  title: string;
  body?: string | null;
  read: boolean;
  actorName?: string | null;
  actorImage?: string | null;
  createdAt: string | Date;
  onClick?: () => void;
  actions?: ReactNode;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NotificationItem({
  title,
  body,
  read,
  actorName,
  actorImage,
  createdAt,
  onClick,
  actions,
}: NotificationItemProps) {
  const date =
    createdAt instanceof Date ? createdAt : new Date(createdAt);

  const content = (
    <>
      <div className="notification-item-indicator">
        <div className="notification-item-dot" data-read={read} />
      </div>
      <Avatar size="sm" name={actorName ?? "System"} src={actorImage ?? undefined} />
      <div className="notification-item-content">
        <div className="notification-item-title">{title}</div>
        {body && <div className="notification-item-body">{body}</div>}
        <div className="notification-item-time">
          {formatRelativeTime(date)}
        </div>
        {actions && (
          <div className="notification-item-actions">{actions}</div>
        )}
      </div>
    </>
  );

  if (actions) {
    return (
      <div
        className="notification-item"
        data-unread={!read}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="notification-item"
      data-unread={!read}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

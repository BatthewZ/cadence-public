import { Bell } from "lucide-react";
import { Link } from "react-router-dom";

import { Skeleton } from "@/web/components/ui/Skeleton";

import { NotificationItem } from "./NotificationItem";

interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  read: boolean;
  actorName?: string | null;
  actorImage?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  invitationId?: string | null;
  createdAt: string;
}

interface NotificationPanelProps {
  notifications: Notification[];
  isLoading: boolean;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onNavigate: (notification: Notification) => void;
  onClose?: () => void;
  hasUnread: boolean;
  /** Absolute path for the "View all notifications" link. Defaults to /notifications. */
  viewAllHref?: string;
}

export function NotificationPanel({
  notifications,
  isLoading,
  onMarkAllRead,
  onMarkRead,
  onNavigate,
  onClose,
  hasUnread,
  viewAllHref = "/notifications",
}: NotificationPanelProps) {
  return (
    <div className="notification-panel">
      <div className="notification-panel-header">
        <span className="notification-panel-header-title">Notifications</span>
        <button
          type="button"
          className="notification-panel-header-action"
          onClick={onMarkAllRead}
          disabled={!hasUnread}
        >
          Mark all read
        </button>
      </div>

      <div className="notification-panel-list">
        {isLoading ? (
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Skeleton variant="circular" width={32} height={32} />
                <div style={{ flex: 1 }}>
                  <Skeleton width="80%" height={14} />
                  <Skeleton width="40%" height={12} style={{ marginTop: 6 }} />
                </div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="notification-panel-empty">
            <Bell size={32} className="notification-panel-empty-icon" />
            <span className="notification-panel-empty-text">No notifications yet</span>
          </div>
        ) : (
          notifications.map((n) => (
            <NotificationItem
              key={n.id}
              title={n.title}
              body={n.body}
              read={n.read}
              actorName={n.actorName}
              actorImage={n.actorImage}
              createdAt={n.createdAt}
              onClick={() => {
                if (!n.read) onMarkRead(n.id);
                onNavigate(n);
              }}
            />
          ))
        )}
      </div>

      <div className="notification-panel-footer">
        <Link
          to={viewAllHref}
          className="notification-panel-footer-link"
          onClick={onClose}
        >
          View all notifications
        </Link>
      </div>
    </div>
  );
}

export type { Notification };

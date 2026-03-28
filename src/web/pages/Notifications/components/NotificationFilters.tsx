import { Tabs } from "@/web/components/ui";

interface NotificationFiltersProps {
  unreadOnly: boolean;
  setUnreadOnly: (value: boolean) => void;
  unreadCount: number;
}

export function NotificationFilters({
  unreadOnly,
  setUnreadOnly,
  unreadCount,
}: NotificationFiltersProps) {
  return (
    <Tabs
      defaultValue="all"
      value={unreadOnly ? "unread" : "all"}
      onValueChange={(v) => setUnreadOnly(v === "unread")}
      variant="underline"
      className="mb-r3"
    >
      <Tabs.List>
        <Tabs.Tab value="all">All</Tabs.Tab>
        <Tabs.Tab value="unread">
          Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
        </Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
}

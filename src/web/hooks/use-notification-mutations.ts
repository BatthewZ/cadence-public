import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Notification } from "@/web/components/layout/NotificationPanel";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

interface NotificationsPage {
  notifications: Notification[];
  nextCursor: string | null;
}

type FlatListData = { notifications: Notification[] };
type InfiniteListData = { pages: NotificationsPage[]; pageParams: unknown[] };
type CountData = { count: number };

/**
 * Shared optimistic mark-read and mark-all-read mutations for notifications.
 *
 * Both the NotificationBell (flat list query) and the Notifications page
 * (infinite query) need identical optimistic update logic for the unread
 * count and the bell's flat list cache. The Notifications page additionally
 * updates its own infinite query pages. By centralising here we avoid
 * duplicating ~60 lines of cache manipulation in each consumer.
 */
export function useNotificationMutations(opts?: {
  /** When provided, the infinite list for this filter set is also optimistically updated. */
  infiniteListFilter?: { unreadOnly: boolean };
}) {
  const qc = useQueryClient();
  const infiniteKey = opts?.infiniteListFilter != null
    ? queryKeys.notifications.list(opts.infiniteListFilter)
    : null;

  /** Invalidate all notification caches after the server responds. */
  function invalidateAll() {
    void qc.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount });
    void qc.invalidateQueries({ queryKey: queryKeys.notifications.list() });
  }

  // -----------------------------------------------------------------------
  // Mark a single notification as read
  // -----------------------------------------------------------------------

  const markReadMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/api/notifications/${id}/read`, {}),
    onMutate: async (id) => {
      // Capture the current infiniteKey so rollback targets the correct query key
      // even if the user toggles the filter while the mutation is in-flight.
      const capturedInfiniteKey = infiniteKey;
      await qc.cancelQueries({ queryKey: queryKeys.notifications.all });
      const previousFlatList = qc.getQueryData<FlatListData>(queryKeys.notifications.list());
      const previousCount = qc.getQueryData<CountData>(queryKeys.notifications.unreadCount);
      const previousInfinite = capturedInfiniteKey
        ? qc.getQueryData<InfiniteListData>(capturedInfiniteKey)
        : undefined;

      // Only decrement the count if the notification was not already read.
      // Check both flat list and infinite list since only one may be populated.
      let wasAlreadyRead = false;
      if (previousFlatList) {
        wasAlreadyRead = previousFlatList.notifications.find((n) => n.id === id)?.read ?? false;
      } else if (previousInfinite) {
        for (const page of previousInfinite.pages) {
          const found = page.notifications.find((n) => n.id === id);
          if (found) {
            wasAlreadyRead = found.read;
            break;
          }
        }
      }

      // Update flat list (bell popover)
      qc.setQueryData<FlatListData>(queryKeys.notifications.list(), (old) =>
        old ? { notifications: old.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) } : old,
      );

      // Update infinite list if applicable (full notifications page)
      if (capturedInfiniteKey) {
        qc.setQueryData<InfiniteListData>(capturedInfiniteKey, (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  notifications: page.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
                })),
              }
            : old,
        );
      }

      // Decrement count only when the notification was genuinely unread
      if (!wasAlreadyRead) {
        qc.setQueryData<CountData>(queryKeys.notifications.unreadCount, (old) =>
          old ? { count: Math.max(0, old.count - 1) } : old,
        );
      }

      return { previousFlatList, previousCount, previousInfinite, capturedInfiniteKey };
    },
    onError: (_err, _id, context) => {
      if (context?.previousFlatList) qc.setQueryData(queryKeys.notifications.list(), context.previousFlatList);
      if (context?.previousCount) qc.setQueryData(queryKeys.notifications.unreadCount, context.previousCount);
      if (context?.previousInfinite && context.capturedInfiniteKey) qc.setQueryData(context.capturedInfiniteKey, context.previousInfinite);
    },
    onSettled: invalidateAll,
  });

  // -----------------------------------------------------------------------
  // Mark all notifications as read
  // -----------------------------------------------------------------------

  const markAllReadMutation = useMutation({
    mutationFn: () => api.post("/api/notifications/mark-all-read", {}),
    onMutate: async () => {
      const capturedInfiniteKey = infiniteKey;
      await qc.cancelQueries({ queryKey: queryKeys.notifications.all });
      const previousFlatList = qc.getQueryData<FlatListData>(queryKeys.notifications.list());
      const previousCount = qc.getQueryData<CountData>(queryKeys.notifications.unreadCount);
      const previousInfinite = capturedInfiniteKey
        ? qc.getQueryData<InfiniteListData>(capturedInfiniteKey)
        : undefined;

      // Update flat list (bell popover)
      qc.setQueryData<FlatListData>(queryKeys.notifications.list(), (old) =>
        old ? { notifications: old.notifications.map((n) => ({ ...n, read: true })) } : old,
      );

      // Update infinite list if applicable (full notifications page)
      if (capturedInfiniteKey) {
        qc.setQueryData<InfiniteListData>(capturedInfiniteKey, (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  notifications: page.notifications.map((n) => ({ ...n, read: true })),
                })),
              }
            : old,
        );
      }

      // Zero out count
      qc.setQueryData<CountData>(queryKeys.notifications.unreadCount, () => ({ count: 0 }));

      return { previousFlatList, previousCount, previousInfinite, capturedInfiniteKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousFlatList) qc.setQueryData(queryKeys.notifications.list(), context.previousFlatList);
      if (context?.previousCount) qc.setQueryData(queryKeys.notifications.unreadCount, context.previousCount);
      if (context?.previousInfinite && context.capturedInfiniteKey) qc.setQueryData(context.capturedInfiniteKey, context.previousInfinite);
    },
    onSettled: invalidateAll,
  });

  return { markReadMutation, markAllReadMutation };
}

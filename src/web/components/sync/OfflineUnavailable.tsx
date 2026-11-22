import { WifiOff } from "lucide-react";

import { Center } from "@/web/components/layout/Center";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateIcon,
  EmptyStateTitle,
} from "@/web/components/ui/EmptyState";
import { cn } from "@/web/util/style/style";

/**
 * Shown in place of a screen whose data was never loaded on this device and can't be fetched
 * because there's no connection. A query in this state is `fetchStatus: "paused"` with no data.
 */
export function OfflineUnavailable({
  what = "This page",
  className,
}: {
  what?: string;
  className?: string;
}) {
  return (
    <Center className={cn("min-h-[50vh]", className)}>
      <EmptyState size="md" role="status">
        <EmptyStateIcon>
          <WifiOff size={28} />
        </EmptyStateIcon>
        <EmptyStateTitle>You&rsquo;re offline</EmptyStateTitle>
        <EmptyStateDescription>
          {what} hasn&rsquo;t been opened on this device yet, so there&rsquo;s nothing saved to
          show. It will load when you&rsquo;re back online.
        </EmptyStateDescription>
      </EmptyState>
    </Center>
  );
}

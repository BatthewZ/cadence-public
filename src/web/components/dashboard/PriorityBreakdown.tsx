import { Row, Stack } from "@/web/components/layout";
import {
  Card,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  Text,
} from "@/web/components/ui";
import {
  PRIORITY_DOT_CLASS,
  PRIORITY_LABEL,
} from "@/web/util/task-display";

const PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"] as const;

const PRIORITY_BAR_CLASS: Record<string, string> = {
  urgent: "bg-status-error",
  high: "bg-status-warning",
  medium: "bg-status-info",
  low: "bg-surface-3",
  none: "bg-surface-2",
};

export function PriorityBreakdownSection({
  priorityBreakdown,
}: {
  priorityBreakdown: { priority: string; count: number }[];
}) {
  const countMap = new Map(priorityBreakdown.map((p) => [p.priority, p.count]));
  const total = priorityBreakdown.reduce((sum, p) => sum + p.count, 0);

  const entries = PRIORITY_ORDER.map((p) => ({
    priority: p,
    count: countMap.get(p) ?? 0,
    label: PRIORITY_LABEL[p],
    dotClass: PRIORITY_DOT_CLASS[p],
    barClass: PRIORITY_BAR_CLASS[p],
  })).filter((e) => e.count > 0);

  return (
    <Card>
      <Stack gap="r4">
        <Text variant="h6">Priority Breakdown</Text>
        {total === 0 ? (
          <EmptyState size="sm">
            <EmptyStateTitle>No active tasks</EmptyStateTitle>
            <EmptyStateDescription>
              Active tasks will appear here grouped by priority.
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <Stack gap="r5">
            {/* Stacked bar */}
            <div className="flex h-3 w-full overflow-hidden rounded-full">
              {entries.map((e) => (
                <div
                  key={e.priority}
                  className={`${e.barClass} transition-all duration-normal`}
                  style={{ width: `${(e.count / total) * 100}%` }}
                  title={`${e.label}: ${e.count}`}
                />
              ))}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-r3 gap-y-r6">
              {entries.map((e) => (
                <Row key={e.priority} gap="r6" align="center">
                  <span
                    className={`inline-block size-2 rounded-full ${e.dotClass}`}
                  />
                  <Text variant="body-3" color="secondary">
                    {e.label}
                  </Text>
                  <Text variant="body-3" weight="semibold">
                    {e.count}
                  </Text>
                </Row>
              ))}
            </div>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

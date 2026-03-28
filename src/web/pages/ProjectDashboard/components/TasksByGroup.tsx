import { Row, Stack } from "@/web/components/layout";
import {
  Card,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  Text,
} from "@/web/components/ui";
import type { ProjectDashboardData } from "@/web/hooks/use-project-dashboard";
import { TASK_GROUP_COLORS } from "@/web/util/task-display";

export function TasksByGroupSection({
  tasksByGroup,
  totalCount,
}: {
  tasksByGroup: ProjectDashboardData["tasksByGroup"];
  totalCount: number;
}) {
  const sorted = [...tasksByGroup].sort((a, b) => b.count - a.count);

  return (
    <Card>
      <Stack gap="r4">
        <Text variant="h6">Tasks by Section</Text>
        {sorted.length === 0 ? (
          <EmptyState size="sm">
            <EmptyStateTitle>No tasks yet</EmptyStateTitle>
            <EmptyStateDescription>
              Create tasks on the Board to see how they distribute across
              sections.
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <Stack gap="r5">
            {sorted.map((group, i) => {
              const pct = totalCount > 0 ? (group.count / totalCount) * 100 : 0;
              const color = TASK_GROUP_COLORS[i % TASK_GROUP_COLORS.length];

              return (
                <Stack key={group.taskGroupId} gap="r6">
                  <Row justify="between" align="center">
                    <Text variant="body-2">{group.taskGroupName}</Text>
                    <Text variant="body-3" color="muted">
                      {group.count}
                    </Text>
                  </Row>
                  <div
                    className="progress-bar progress-bar--sm"
                    role="progressbar"
                    aria-valuenow={group.count}
                    aria-valuemin={0}
                    aria-valuemax={totalCount}
                  >
                    <div
                      className="progress-bar__fill"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </Stack>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

import { Users } from "lucide-react";

import { Row, Stack } from "@/web/components/layout";
import {
  Avatar,
  Card,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  ProgressBar,
  Text,
} from "@/web/components/ui";

interface TeamMember {
  id: string;
  name: string;
  image?: string | null;
  count: number;
}

export function TeamWorkloadSection({
  tasksPerMember,
}: {
  tasksPerMember: TeamMember[];
}) {
  const sorted = [...tasksPerMember].sort((a, b) => b.count - a.count);
  const maxCount = sorted.length > 0 ? sorted[0].count : 1;

  return (
    <Card>
      <Stack gap="r4">
        <Row gap="r5" align="center">
          <Users size={16} className="text-fg-secondary" />
          <Text variant="h6">Team Workload</Text>
        </Row>
        {sorted.length === 0 ? (
          <EmptyState size="sm">
            <EmptyStateTitle>No tasks assigned yet</EmptyStateTitle>
            <EmptyStateDescription>
              Assign tasks to team members to see workload distribution.
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <Stack gap="r5">
            {sorted.map((member) => {
              const pct = maxCount > 0 ? (member.count / maxCount) * 100 : 0;

              return (
                <Stack key={member.id} gap="r6">
                  <Row justify="between" align="center">
                    <Row gap="r5" align="center">
                      <Avatar
                        size="xs"
                        name={member.name}
                        src={member.image ?? undefined}
                      />
                      <Text variant="body-2">{member.name}</Text>
                    </Row>
                    <Text variant="body-3" color="muted">
                      {member.count} {member.count === 1 ? "task" : "tasks"}
                    </Text>
                  </Row>
                  <ProgressBar value={pct} size="sm" color="accent" />
                </Stack>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

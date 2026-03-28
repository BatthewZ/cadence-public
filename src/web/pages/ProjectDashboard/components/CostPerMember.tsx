import { DollarSign } from "lucide-react";

import { Row, Stack } from "@/web/components/layout";
import { Avatar, Card, ProgressBar, Text } from "@/web/components/ui";
import type { ProjectDashboardData } from "@/web/hooks/use-project-dashboard";
import { formatCurrency } from "@/web/util/format";

export function CostPerMemberSection({
  costPerMember,
}: {
  costPerMember: ProjectDashboardData["costPerMember"];
}) {
  if (costPerMember.length === 0) return null;

  const sorted = [...costPerMember].sort((a, b) => b.totalCost - a.totalCost);
  const maxCost = sorted.length > 0 ? sorted[0].totalCost : 1;

  return (
    <Card>
      <Stack gap="r4">
        <Row gap="r5" align="center">
          <DollarSign size={16} className="text-fg-secondary" />
          <Text variant="h6">Cost by Member</Text>
        </Row>
        <Stack gap="r5">
          {sorted.map((member) => {
            const pct = maxCost > 0 ? (member.totalCost / maxCost) * 100 : 0;
            return (
              <Stack key={member.id} gap="r6">
                <Row justify="between" align="center">
                  <Row gap="r5" align="center">
                    <Avatar size="xs" name={member.name} />
                    <Text variant="body-2">{member.name}</Text>
                  </Row>
                  <Text variant="body-3" color="muted">
                    {formatCurrency(member.totalCost)}
                  </Text>
                </Row>
                <ProgressBar value={pct} size="sm" color="accent" />
              </Stack>
            );
          })}
        </Stack>
      </Stack>
    </Card>
  );
}

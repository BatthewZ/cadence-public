import { DollarSign } from "lucide-react";

import { Row, Stack } from "@/web/components/layout";
import { Card, ProgressBar, Text } from "@/web/components/ui";
import { formatCurrency } from "@/web/util/format";

import type { DashboardStatsResponse } from "./types";

function CostSummaryCard({
  costAggregation,
}: {
  costAggregation: DashboardStatsResponse["costAggregation"];
}) {
  if (costAggregation.tasksWithCost === 0) return null;

  const { totalCost, completedCost, activeCost } = costAggregation;

  return (
    <Card>
      <Stack gap="r4">
        <Row gap="r5" align="center">
          <DollarSign size={16} className="text-fg-secondary" />
          <Text variant="h6">Cost Breakdown</Text>
        </Row>
        <div className="grid grid-cols-2 gap-r4">
          <Stack gap="r6">
            <Text variant="body-3" color="muted">
              Completed
            </Text>
            <Text variant="body-1" weight="semibold">
              {formatCurrency(completedCost)}
            </Text>
          </Stack>
          <Stack gap="r6">
            <Text variant="body-3" color="muted">
              In Progress
            </Text>
            <Text variant="body-1" weight="semibold">
              {formatCurrency(activeCost)}
            </Text>
          </Stack>
        </div>
        {totalCost > 0 && (
          <ProgressBar
            value={(completedCost / totalCost) * 100}
            size="sm"
            color="accent"
          />
        )}
      </Stack>
    </Card>
  );
}

export { CostSummaryCard };

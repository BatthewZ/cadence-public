import { DollarSign, FolderKanban } from "lucide-react";

import { TaskMetricsCards } from "@/web/components/dashboard/TaskMetricsCards";
import { StatCard } from "@/web/components/ui";
import { formatCurrency } from "@/web/util/format";

import type { DashboardStatsResponse } from "./types";

function StatCardsRow({
  taskCounts,
  projectCount,
  costAggregation,
}: {
  taskCounts: DashboardStatsResponse["taskCounts"];
  projectCount: number;
  costAggregation?: DashboardStatsResponse["costAggregation"];
}) {
  const hasCost = costAggregation && costAggregation.tasksWithCost > 0;

  return (
    <TaskMetricsCards
      taskCounts={taskCounts}
      gridClassName={`grid grid-cols-2 gap-r3 sm:gap-r4 [&>:last-child:nth-child(odd)]:col-span-2 sm:[&>:last-child:nth-child(odd)]:col-span-1 ${hasCost ? "sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-4"}`}
      extraCards={
        <>
          <StatCard>
            <StatCard.Icon>
              <FolderKanban size={16} />
            </StatCard.Icon>
            <StatCard.Label>Active Projects</StatCard.Label>
            <StatCard.Value animateValue from={0} to={projectCount}>
              {projectCount}
            </StatCard.Value>
          </StatCard>

          {hasCost && (
            <StatCard>
              <StatCard.Icon>
                <DollarSign size={16} />
              </StatCard.Icon>
              <StatCard.Label>Total Cost</StatCard.Label>
              <StatCard.Value
                animateValue
                from={0}
                to={costAggregation.totalCost}
                format={formatCurrency}
              >
                {formatCurrency(costAggregation.totalCost)}
              </StatCard.Value>
            </StatCard>
          )}
        </>
      }
    />
  );
}

export { StatCardsRow };

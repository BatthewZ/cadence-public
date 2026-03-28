import { CheckCircle2, CircleDot, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

import { StatCard } from "@/web/components/ui";

interface TaskCounts {
  activeCount: number;
  completedCount: number;
  totalCount: number;
}

interface TaskMetricsCardsProps {
  taskCounts: TaskCounts;
  /**
   * Additional stat cards rendered after the three core metric cards.
   * The workspace dashboard uses this to append Active Projects and Total Cost cards.
   */
  extraCards?: ReactNode;
  /** CSS class name applied to the grid container for layout customization. */
  gridClassName?: string;
}

/**
 * Renders the three core task-metric stat cards shared by both the workspace
 * and project dashboards: Active Tasks, Completed, and Completion Rate.
 *
 * The `extraCards` slot lets the workspace dashboard append its additional
 * cards (Active Projects, Total Cost) while keeping the common cards
 * as a single source of truth.
 */
function TaskMetricsCards({
  taskCounts,
  extraCards,
  gridClassName,
}: TaskMetricsCardsProps) {
  const { activeCount, completedCount, totalCount } = taskCounts;
  const completionRate =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className={gridClassName}>
      <StatCard>
        <StatCard.Icon>
          <CircleDot size={16} />
        </StatCard.Icon>
        <StatCard.Label>Active Tasks</StatCard.Label>
        <StatCard.Value animateValue from={0} to={activeCount}>
          {activeCount}
        </StatCard.Value>
      </StatCard>

      <StatCard>
        <StatCard.Icon>
          <CheckCircle2 size={16} />
        </StatCard.Icon>
        <StatCard.Label>Completed</StatCard.Label>
        <StatCard.Value animateValue from={0} to={completedCount}>
          {completedCount}
        </StatCard.Value>
      </StatCard>

      <StatCard>
        <StatCard.Icon>
          <TrendingUp size={16} />
        </StatCard.Icon>
        <StatCard.Label>Completion Rate</StatCard.Label>
        <StatCard.Value
          animateValue
          from={0}
          to={completionRate}
          format={(v) => `${v}%`}
        >
          {completionRate}%
        </StatCard.Value>
      </StatCard>

      {extraCards}
    </div>
  );
}

export { TaskMetricsCards };
export type { TaskCounts };

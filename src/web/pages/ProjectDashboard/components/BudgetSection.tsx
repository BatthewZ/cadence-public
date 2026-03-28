import { CheckCircle2, CircleDot, DollarSign } from "lucide-react";

import { Row, Stack } from "@/web/components/layout";
import {
  Badge,
  Card,
  ProgressBar,
  StatCard,
  Text,
} from "@/web/components/ui";
import type { ProjectDashboardData } from "@/web/hooks/use-project-dashboard";
import { formatCurrency } from "@/web/util/format";

import { CostPerMemberSection } from "./CostPerMember";

export function BudgetAndCostsSection({ data }: { data: ProjectDashboardData }) {
  if (data.costAggregation.tasksWithCost === 0) return null;

  return (
    <Stack gap="r4">
      <Row gap="r5" align="center">
        <DollarSign size={16} className="text-fg-secondary" />
        <Text variant="h5">Budget & Costs</Text>
      </Row>
      <div className="grid grid-cols-1 gap-r4 sm:grid-cols-3">
        <StatCard>
          <StatCard.Icon>
            <DollarSign size={16} />
          </StatCard.Icon>
          <StatCard.Label>Total Cost</StatCard.Label>
          <StatCard.Value
            animateValue
            from={0}
            to={data.costAggregation.totalCost}
            format={formatCurrency}
          >
            {formatCurrency(data.costAggregation.totalCost)}
          </StatCard.Value>
        </StatCard>
        <StatCard>
          <StatCard.Icon>
            <CheckCircle2 size={16} />
          </StatCard.Icon>
          <StatCard.Label>Completed Cost</StatCard.Label>
          <StatCard.Value
            animateValue
            from={0}
            to={data.costAggregation.completedCost}
            format={formatCurrency}
          >
            {formatCurrency(data.costAggregation.completedCost)}
          </StatCard.Value>
        </StatCard>
        <StatCard>
          <StatCard.Icon>
            <CircleDot size={16} />
          </StatCard.Icon>
          <StatCard.Label>Active Cost</StatCard.Label>
          <StatCard.Value
            animateValue
            from={0}
            to={data.costAggregation.activeCost}
            format={formatCurrency}
          >
            {formatCurrency(data.costAggregation.activeCost)}
          </StatCard.Value>
        </StatCard>
      </div>
      <BudgetCard
        budget={data.budget}
        costAggregation={data.costAggregation}
      />
      <CostPerMemberSection costPerMember={data.costPerMember} />
    </Stack>
  );
}

export function BudgetCard({
  budget,
  costAggregation,
}: {
  budget: number | null;
  costAggregation: ProjectDashboardData["costAggregation"];
}) {
  if (!budget || costAggregation.tasksWithCost === 0) return null;

  const spent = costAggregation.totalCost;
  const remaining = budget - spent;
  const pct = Math.min((spent / budget) * 100, 100);
  const isOverBudget = spent > budget;
  const overage = spent - budget;
  const overagePercent = budget > 0 ? Math.round((spent / budget) * 100) : 0;

  return (
    <Card>
      <Stack gap="r4">
        <Row gap="r5" align="center">
          <DollarSign size={16} className="text-fg-secondary" />
          <Text variant="h6">Budget</Text>
          {isOverBudget && <Badge variant="error">Over Budget</Badge>}
        </Row>
        <div className="grid grid-cols-3 gap-r4">
          <Stack gap="r6">
            <Text variant="body-3" color="muted">
              Budget
            </Text>
            <Text variant="body-1" weight="semibold">
              {formatCurrency(budget)}
            </Text>
          </Stack>
          <Stack gap="r6">
            <Text variant="body-3" color="muted">
              Spent
            </Text>
            <Text variant="body-1" weight="semibold">
              {formatCurrency(spent)}
            </Text>
          </Stack>
          <Stack gap="r6">
            <Text variant="body-3" color="muted">
              Remaining
            </Text>
            <Text
              variant="body-1"
              weight="semibold"
              className={isOverBudget ? "text-status-error" : ""}
            >
              {isOverBudget
                ? `${formatCurrency(Math.abs(remaining))} over`
                : formatCurrency(remaining)}
            </Text>
          </Stack>
        </div>
        {isOverBudget ? (
          <Stack gap="r6">
            {/* Proportional overage bar: budget portion vs overage portion */}
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="bg-status-warning shrink-0 transition-all duration-normal"
                style={{ width: `${(budget / spent) * 100}%` }}
                title={`Budget: ${formatCurrency(budget)}`}
              />
              <div
                className="bg-status-error shrink-0 transition-all duration-normal"
                style={{ width: `${(overage / spent) * 100}%` }}
                title={`Overage: ${formatCurrency(overage)}`}
              />
            </div>
            <Row justify="between" align="center">
              <Text variant="body-3" className="text-status-error">
                {formatCurrency(overage)} over budget ({overagePercent}% of budget used)
              </Text>
              <Row gap="r5" align="center">
                <Row gap="r6" align="center">
                  <span className="inline-block size-2 rounded-full bg-status-warning" />
                  <Text variant="body-3" color="muted">Budget</Text>
                </Row>
                <Row gap="r6" align="center">
                  <span className="inline-block size-2 rounded-full bg-status-error" />
                  <Text variant="body-3" color="muted">Overage</Text>
                </Row>
              </Row>
            </Row>
          </Stack>
        ) : (
          <ProgressBar
            value={pct}
            size="sm"
            color="accent"
          />
        )}
      </Stack>
    </Card>
  );
}

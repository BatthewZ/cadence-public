import { Row, Stack } from "@/web/components/layout";
import { Card, Skeleton } from "@/web/components/ui";

/**
 * A grid of skeleton stat cards used as loading placeholders for
 * dashboard metric cards. Both workspace and project dashboard skeletons
 * share this pattern (with different grid classes and card counts).
 */
function SkeletonStatGrid({
  count,
  gridClassName,
}: {
  count: number;
  gridClassName: string;
}) {
  return (
    <div className={gridClassName}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <Stack gap="r5">
            <Skeleton variant="text" className="h-4 w-24" />
            <Skeleton variant="text" className="h-8 w-16" />
          </Stack>
        </Card>
      ))}
    </div>
  );
}

/**
 * Skeleton placeholder for a priority-breakdown style card:
 * title, a full-width bar, and a row of label chips.
 */
function SkeletonBreakdownCard() {
  return (
    <Card>
      <Stack gap="r5">
        <Skeleton variant="text" className="h-5 w-36" />
        <Skeleton
          variant="rectangular"
          className="h-3 w-full rounded-full"
        />
        <Row gap="r5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} variant="text" className="h-4 w-16" />
          ))}
        </Row>
      </Stack>
    </Card>
  );
}

/**
 * Skeleton placeholder for a workload / bar-list card:
 * title followed by labeled progress bars.
 */
function SkeletonBarListCard({
  titleWidth = "w-32",
  rowCount = 3,
}: {
  titleWidth?: string;
  rowCount?: number;
}) {
  return (
    <Card>
      <Stack gap="r5">
        <Skeleton variant="text" className={`h-5 ${titleWidth}`} />
        {Array.from({ length: rowCount }, (_, j) => (
          <Stack key={j} gap="r6">
            <Row justify="between">
              <Skeleton variant="text" className="h-4 w-24" />
              <Skeleton variant="text" className="h-4 w-8" />
            </Row>
            <Skeleton
              variant="rectangular"
              className="h-2 w-full rounded"
            />
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}

/**
 * Skeleton placeholder for a simple list card: title followed by
 * full-width row placeholders.
 */
function SkeletonListCard({
  titleWidth = "w-24",
  rowCount = 3,
}: {
  titleWidth?: string;
  rowCount?: number;
}) {
  return (
    <Card>
      <Stack gap="r5">
        <Skeleton variant="text" className={`h-5 ${titleWidth}`} />
        {Array.from({ length: rowCount }, (_, j) => (
          <Skeleton key={j} variant="text" className="h-8 w-full" />
        ))}
      </Stack>
    </Card>
  );
}

/**
 * Skeleton placeholder for the activity feed sidebar: title
 * followed by avatar + text rows that mimic timeline entries.
 */
function SkeletonActivityFeed({ rowCount = 5 }: { rowCount?: number }) {
  return (
    <Card>
      <Stack gap="r5">
        <Skeleton variant="text" className="h-5 w-32" />
        {Array.from({ length: rowCount }, (_, i) => (
          <div key={i} className="flex items-start gap-r5">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </Stack>
    </Card>
  );
}

export {
  SkeletonActivityFeed,
  SkeletonBarListCard,
  SkeletonBreakdownCard,
  SkeletonListCard,
  SkeletonStatGrid,
};

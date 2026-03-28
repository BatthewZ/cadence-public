import {
  SkeletonActivityFeed,
  SkeletonBarListCard,
  SkeletonBreakdownCard,
  SkeletonListCard,
  SkeletonStatGrid,
} from "@/web/components/dashboard/SkeletonPrimitives";
import { Stack } from "@/web/components/layout";

export function DashboardSkeleton() {
  return (
    <Stack gap="r3">
      {/* Stat cards skeleton */}
      <SkeletonStatGrid
        count={3}
        gridClassName="grid grid-cols-1 gap-r4 sm:grid-cols-3"
      />

      {/* Main grid skeleton */}
      <div className="grid grid-cols-1 gap-r4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-[var(--spacing-r4)]">
          {/* Priority breakdown skeleton */}
          <SkeletonBreakdownCard />
          {/* Tasks by section skeleton */}
          <SkeletonBarListCard titleWidth="w-32" rowCount={3} />
          {/* Upcoming deadlines skeleton */}
          <SkeletonListCard titleWidth="w-40" rowCount={3} />
        </div>
        {/* Activity feed skeleton */}
        <SkeletonActivityFeed rowCount={5} />
      </div>
    </Stack>
  );
}

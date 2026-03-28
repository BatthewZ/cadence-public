import {
  SkeletonActivityFeed,
  SkeletonBarListCard,
  SkeletonBreakdownCard,
  SkeletonListCard,
  SkeletonStatGrid,
} from "@/web/components/dashboard/SkeletonPrimitives";
import { Stack } from "@/web/components/layout";

function DashboardSkeleton() {
  return (
    <Stack gap="r3">
      {/* Stat cards skeleton */}
      <SkeletonStatGrid
        count={4}
        gridClassName="grid grid-cols-2 gap-r3 sm:gap-r4 sm:grid-cols-2 lg:grid-cols-4"
      />

      {/* Main grid skeleton */}
      <div className="grid grid-cols-1 gap-r4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-[var(--spacing-r4)]">
          {/* My Tasks skeleton */}
          <SkeletonListCard titleWidth="w-24" rowCount={3} />
          {/* Priority breakdown skeleton */}
          <SkeletonBreakdownCard />
          {/* Team workload skeleton */}
          <SkeletonBarListCard titleWidth="w-32" rowCount={3} />
        </div>
        {/* Activity feed skeleton */}
        <SkeletonActivityFeed rowCount={5} />
      </div>
    </Stack>
  );
}

export { DashboardSkeleton };

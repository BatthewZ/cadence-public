import { Card } from "@/web/components/ui/Card";
import { Skeleton } from "@/web/components/ui/Skeleton";

// ---------------------------------------------------------------------------
// Main Board
// ---------------------------------------------------------------------------

export function BoardSkeletonColumns() {
  return (
    <>
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="flex flex-col w-[16.25rem] min-w-[15rem] sm:w-[18.75rem] sm:min-w-[18.75rem] flex-shrink-0 h-full rounded-lg bg-surface-1"
        >
          <div className="flex items-center gap-2 px-3 py-3 rounded-t-lg">
            <Skeleton variant="circular" className="size-3" />
            <Skeleton variant="text" className="h-4 flex-1" />
            <Skeleton variant="rectangular" className="h-4 w-6 rounded" />
          </div>
          <div className="flex-1 px-2 py-2 flex flex-col gap-1.5">
            {Array.from({ length: 3 - i }, (_, j) => (
              <Card key={j} padding="r5" shadow="sm">
                <div className="flex flex-col gap-1.5">
                  <Skeleton variant="text" className="h-4 w-full" />
                  <Skeleton variant="text" className="h-3 w-2/3" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

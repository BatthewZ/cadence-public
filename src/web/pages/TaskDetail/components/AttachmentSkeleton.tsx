import { Stack } from "@/web/components/layout";
import { Skeleton } from "@/web/components/ui/Skeleton";

export function AttachmentSkeletonList() {
  return (
    <Stack gap="r5">
      {[1, 2].map((i) => (
        <div key={i} className="flex items-center gap-r5 rounded-md border border-border-default px-r4 py-r5">
          <Skeleton variant="rounded" width={40} height={40} />
          <div className="flex-1">
            <Skeleton className="mb-1 h-3 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </Stack>
  );
}

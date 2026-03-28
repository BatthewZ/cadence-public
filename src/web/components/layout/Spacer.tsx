import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type SpacerProps = ComponentPropsWithRef<"div">;

export const Spacer = forwardRef<HTMLDivElement, SpacerProps>(function Spacer(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn("flex-1", className)} {...props} />;
});

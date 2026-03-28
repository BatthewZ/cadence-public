import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type CenterProps = ComponentPropsWithRef<"div">;

export const Center = forwardRef<HTMLDivElement, CenterProps>(function Center(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn("flex items-center justify-center", className)} {...props} />;
});

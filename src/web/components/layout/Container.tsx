import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type ContainerSize = "sm" | "md" | "lg" | "xl" | "full";

const sizeMap: Record<ContainerSize, string> = {
  sm: "max-w-[480px]",
  md: "max-w-[640px]",
  lg: "max-w-[768px]",
  xl: "max-w-[1024px]",
  full: "max-w-full",
};

type ContainerProps = {
  size?: ContainerSize;
} & Omit<ComponentPropsWithRef<"div">, "size">;

export const Container = forwardRef<HTMLDivElement, ContainerProps>(function Container(
  { size = "md", className, ...props },
  ref
) {
  return (
    <div ref={ref} className={cn("mx-auto w-full px-r3", sizeMap[size], className)} {...props} />
  );
});

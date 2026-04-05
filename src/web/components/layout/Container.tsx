import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type ContainerSize = "sm" | "md" | "lg" | "xl" | "full";

const sizeMap: Record<ContainerSize, string> = {
  sm: "max-w-[30rem]",
  md: "max-w-[40rem]",
  lg: "max-w-[48rem]",
  xl: "max-w-[64rem]",
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

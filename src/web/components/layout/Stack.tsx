import { type ComponentPropsWithRef, type ElementType, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

import { type Gap, gapMap } from "./shared";

type StackProps<T extends ElementType = "div"> = {
  gap?: Gap;
  as?: T;
} & Omit<ComponentPropsWithRef<T>, "as" | "gap">;

export const Stack = forwardRef<HTMLElement, StackProps>(function Stack(
  { gap = "r4", as: Tag = "div", className, ...props },
  ref
) {
  return (
    <Tag ref={ref as never} className={cn("flex flex-col", gapMap[gap], className)} {...props} />
  );
}) as <T extends ElementType = "div">(props: StackProps<T>) => React.JSX.Element;

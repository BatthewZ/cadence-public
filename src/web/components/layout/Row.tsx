import { type ComponentPropsWithRef, type ElementType, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

import { type Gap, gapMap } from "./shared";

const alignMap = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
  baseline: "items-baseline",
} as const;

const justifyMap = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
} as const;

type RowProps<T extends ElementType = "div"> = {
  gap?: Gap;
  align?: keyof typeof alignMap;
  justify?: keyof typeof justifyMap;
  wrap?: boolean;
  as?: T;
} & Omit<ComponentPropsWithRef<T>, "as" | "gap" | "align" | "justify" | "wrap">;

export const Row = forwardRef<HTMLElement, RowProps>(function Row(
  {
    gap = "r5",
    align = "center",
    justify = "start",
    wrap = false,
    as: Tag = "div",
    className,
    ...props
  },
  ref
) {
  return (
    <Tag
      ref={ref as never}
      className={cn(
        "flex flex-row",
        alignMap[align],
        justifyMap[justify],
        gapMap[gap],
        wrap && "flex-wrap",
        className
      )}
      {...props}
    />
  );
}) as <T extends ElementType = "div">(props: RowProps<T>) => React.JSX.Element;

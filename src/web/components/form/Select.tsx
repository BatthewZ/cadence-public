import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

import { useFieldErrorProps } from "./Field";

type SelectProps = {
  error?: boolean;
} & ComponentPropsWithRef<"select">;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { error, className, ...props },
  ref
) {
  const fieldErrorProps = useFieldErrorProps(error);
  return (
    <select
      ref={ref}
      {...fieldErrorProps}
      className={cn(
        "w-full px-r4 py-r5 text-body-2 text-fg-primary",
        "bg-surface-0 border border-border-strong rounded-md",
        "placeholder:text-fg-muted",
        "duration-fast",
        "focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-0 focus:border-border-focus",
        "disabled:bg-surface-3 disabled:cursor-not-allowed",
        "appearance-none bg-no-repeat bg-position-[right_0.5rem_center] bg-size-[1.5em_1.5em] pr-10",
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22currentColor%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')]",
        error && "border-status-error focus:ring-status-error",
        className
      )}
      {...props}
    />
  );
});

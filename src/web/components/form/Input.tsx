import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

import { useFieldErrorProps } from "./Field";

type InputProps = {
  error?: boolean;
} & ComponentPropsWithRef<"input">;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { error, className, ...props },
  ref
) {
  const fieldErrorProps = useFieldErrorProps(error);
  return (
    <input
      ref={ref}
      {...fieldErrorProps}
      className={cn(
        "w-full px-r4 py-r5 text-body-2 text-fg-primary",
        "bg-surface-0 border border-border-strong rounded-md",
        "placeholder:text-fg-muted",
        "duration-fast",
        "focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-0 focus:border-border-focus",
        "disabled:bg-surface-3 disabled:cursor-not-allowed",
        error && "border-status-error focus:ring-status-error",
        className
      )}
      {...props}
    />
  );
});

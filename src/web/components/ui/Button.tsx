import { type ComponentPropsWithRef, type ElementType, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type Variant = "primary" | "secondary" | "ghost" | "ghost-inverse" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const baseClasses =
  "inline-flex items-center justify-center font-semibold whitespace-nowrap duration-fast cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ring-2 ring-transparent focus-visible:ring-border-focus focus-visible:ring-offset-2";

const variantClassMap: Record<Variant, string> = {
  primary: "bg-primary text-fg-on-primary hover:bg-primary-hover active:bg-primary-active",
  secondary: "bg-secondary text-fg-primary hover:bg-secondary-hover",
  ghost: "bg-transparent text-fg-secondary hover:bg-surface-2",
  "ghost-inverse": "bg-transparent text-fg-on-primary hover:bg-white/15",
  danger: "bg-status-error text-fg-inverse hover:bg-status-error/90",
  link: "text-accent hover:underline font-bold",
};

const sizeClassMap: Record<Size, string> = {
  sm: "text-body-3 leading-tight px-r5 py-r6 rounded-md",
  md: "text-body-2 leading-tight px-r4 py-r5 rounded-md",
  lg: "text-body-1 leading-tight px-r3 py-r5 rounded-md",
};

type ButtonProps<T extends ElementType = "button"> = {
  variant?: Variant;
  size?: Size;
  as?: T;
} & Omit<ComponentPropsWithRef<T>, "as" | "size">;

export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", as: Tag = "button", className, ...props },
  ref
) {
  return (
    <Tag
      ref={ref as never}
      className={cn(baseClasses, variantClassMap[variant], sizeClassMap[size], className)}
      {...props}
    />
  );
}) as <T extends ElementType = "button">(props: ButtonProps<T>) => React.JSX.Element;

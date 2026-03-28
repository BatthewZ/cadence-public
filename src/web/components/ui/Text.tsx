import { type ComponentPropsWithRef, type ElementType, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type Variant = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "body-1" | "body-2" | "body-3";

type Color = "primary" | "secondary" | "muted" | "inverse" | "on-primary";

const variantClassMap: Record<Variant, string> = {
  h1: "text-h1",
  h2: "text-h2",
  h3: "text-h3",
  h4: "text-h4",
  h5: "text-h5",
  h6: "text-h6",
  "body-1": "text-body-1",
  "body-2": "text-body-2",
  "body-3": "text-body-3",
};

const colorClassMap: Record<Color, string> = {
  primary: "text-fg-primary",
  secondary: "text-fg-secondary",
  muted: "text-fg-muted",
  inverse: "text-fg-inverse",
  "on-primary": "text-fg-on-primary",
};

const defaultElementMap: Record<Variant, ElementType> = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  "body-1": "p",
  "body-2": "p",
  "body-3": "p",
};

type TextProps<T extends ElementType = "p"> = {
  variant?: Variant;
  weight?: "semibold" | "bold";
  color?: Color;
  as?: T;
} & Omit<ComponentPropsWithRef<T>, "as" | "color">;

export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  { variant = "body-1", weight, color = "primary", as, className, ...props },
  ref
) {
  const Tag = as ?? defaultElementMap[variant];

  return (
    <Tag
      ref={ref as never}
      className={cn(
        variantClassMap[variant],
        colorClassMap[color],
        weight && `font-${weight}`,
        className
      )}
      {...props}
    />
  );
}) as <T extends ElementType = "p">(props: TextProps<T>) => React.JSX.Element;

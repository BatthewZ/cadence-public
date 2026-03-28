import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ["r1", "r2", "r3", "r4", "r5", "r6"],
      color: [
        "canvas",
        "primary",
        "primary-hover",
        "primary-active",
        "secondary",
        "secondary-hover",
        "accent",
        "accent-hover",
        "accent-subtle",
        "accent-muted",
        "surface-0",
        "surface-1",
        "surface-2",
        "surface-3",
        "fg-primary",
        "fg-secondary",
        "fg-muted",
        "fg-inverse",
        "fg-on-primary",
        "fg-on-accent",
        "border-default",
        "border-strong",
        "border-focus",
        "status-error",
        "status-error-bg",
        "status-success",
        "status-success-bg",
        "status-warning",
        "status-warning-bg",
        "status-info",
        "status-info-bg",
      ],
      text: ["h1", "h2", "h3", "h4", "h5", "h6", "body-1", "body-2", "body-3"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

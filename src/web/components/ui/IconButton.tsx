import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

type IconButtonProps = {
  "aria-label": string;
} & ComponentPropsWithRef<"button">;

const baseClasses =
  "inline-flex items-center justify-center rounded-md p-r5 text-fg-secondary hover:bg-surface-2 active:bg-surface-3 active:scale-95 duration-fast cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ring-2 ring-transparent focus-visible:ring-border-focus focus-visible:ring-offset-2";

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, ...props },
  ref
) {
  return <button ref={ref} className={cn(baseClasses, className)} {...props} />;
});

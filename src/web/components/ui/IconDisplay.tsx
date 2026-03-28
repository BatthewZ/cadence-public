import { type LucideIcon } from "lucide-react";
import { type ComponentPropsWithRef, forwardRef } from "react";

import { getIconComponent } from "@/web/lib/icon-map";
import { cn } from "@/web/util/style/style";

type IconDisplayProps = {
  /** Curated icon name (kebab-case) from CURATED_ICONS. */
  name: string | null | undefined;
  /** Fallback lucide icon component to render when name is empty or unknown. */
  fallback?: LucideIcon;
  /** Icon pixel size passed to the lucide icon. Defaults to 20. */
  size?: number;
} & Omit<ComponentPropsWithRef<"span">, "children">;

function ResolvedIcon({ icon: Icon, size }: { icon: LucideIcon; size: number }) {
  return <Icon size={size} />;
}

/**
 * Renders a lucide icon by its curated name string.
 * Returns null if the name is unknown and no fallback is provided.
 */
export const IconDisplay = forwardRef<HTMLSpanElement, IconDisplayProps>(
  function IconDisplay({ name, fallback, size = 20, className, ...props }, ref) {
    const Icon = getIconComponent(name) ?? fallback;
    if (!Icon) return null;

    return (
      <span
        ref={ref}
        className={cn("inline-flex shrink-0 items-center justify-center", className)}
        {...props}
      >
        <ResolvedIcon icon={Icon} size={size} />
      </span>
    );
  }
);

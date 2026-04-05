import { Image, X } from "lucide-react";
import { type ComponentPropsWithRef, forwardRef, useMemo, useState } from "react";

import { CURATED_ICONS } from "@/shared/constants/curated-icons";
import { ICON_TAGS } from "@/shared/constants/icon-tags";
import { SearchInput } from "@/web/components/form/SearchInput";
import { getIconComponent } from "@/web/lib/icon-map";
import { cn } from "@/web/util/style/style";

import { IconButton } from "./IconButton";
import { IconDisplay } from "./IconDisplay";
import { Popover } from "./Popover";
import { Tooltip } from "./Tooltip";

/* ------------------------------------------------------------------ */
/*  Icon Grid (shared between full and compact modes)                 */
/* ------------------------------------------------------------------ */

interface IconGridProps {
  value: string | null;
  onChange: (name: string | null) => void;
  /** When false, renders tooltips inline instead of portaling. Use inside native dialogs. */
  tooltipPortal?: boolean;
}

export function IconGrid({ value, onChange, tooltipPortal }: IconGridProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return CURATED_ICONS;
    const lower = search.toLowerCase();
    return CURATED_ICONS.filter(
      (name) =>
        name.includes(lower) ||
        ICON_TAGS[name].some((tag) => tag.includes(lower))
    );
  }, [search]);

  return (
    <div className="flex flex-col gap-r5">
      <div className="flex items-center gap-r5">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter icons..."
          size="sm"
          className="flex-1"
        />
        {value && (
          <Tooltip content="Clear selection" portal={tooltipPortal}>
            <IconButton
              aria-label="Clear icon selection"
              onClick={() => onChange(null)}
              className="shrink-0"
            >
              <X size={16} />
            </IconButton>
          </Tooltip>
        )}
      </div>

      <div
        role="listbox"
        aria-label="Icon selection"
        className="grid grid-cols-6 gap-0.5 max-h-[15rem] overflow-y-auto p-0.5"
      >
        {filtered.map((name) => {
          const Icon = getIconComponent(name);
          if (!Icon) return null;
          const selected = value === name;

          return (
            <Tooltip key={name} content={name} portal={tooltipPortal}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={name}
                onClick={() => onChange(name)}
                className={cn(
                  "inline-flex items-center justify-center rounded-md p-1 duration-fast cursor-pointer",
                  "text-fg-secondary hover:bg-surface-2 active:bg-surface-3 active:scale-95",
                  "ring-2 ring-transparent focus-visible:ring-border-focus focus-visible:ring-offset-2",
                  selected && "bg-accent-subtle text-accent ring-accent"
                )}
              >
                <Icon size={20} />
              </button>
            </Tooltip>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-body-3 text-fg-muted text-center py-r6">
          No icons match your search.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Full Icon Picker                                                  */
/* ------------------------------------------------------------------ */

type IconPickerProps = {
  /** Currently selected icon name, or null for no selection. */
  value: string | null;
  /** Called when a new icon is selected or the selection is cleared. */
  onChange: (name: string | null) => void;
  /** When true, renders a compact trigger button that opens a popover. */
  compact?: boolean;
  /** When false, renders the popover inline instead of portaling. Use inside native dialogs. */
  portal?: boolean;
} & Omit<ComponentPropsWithRef<"div">, "onChange">;

/**
 * Icon picker with search, grid selection, and optional compact popover mode.
 * Uses the curated icon set defined in CURATED_ICONS.
 */
export const IconPicker = forwardRef<HTMLDivElement, IconPickerProps>(
  function IconPicker({ value, onChange, compact = false, portal, className, ...props }, ref) {
    if (compact) {
      return (
        <CompactIconPicker
          ref={ref}
          value={value}
          onChange={onChange}
          portal={portal}
          className={className}
          {...props}
        />
      );
    }

    return (
      <div ref={ref} className={cn("w-full", className)} {...props}>
        <IconGrid value={value} onChange={onChange} tooltipPortal={portal} />
      </div>
    );
  }
);

/* ------------------------------------------------------------------ */
/*  Compact Icon Picker (popover mode)                                */
/* ------------------------------------------------------------------ */

type CompactIconPickerProps = {
  value: string | null;
  onChange: (name: string | null) => void;
  portal?: boolean;
} & Omit<ComponentPropsWithRef<"div">, "onChange">;

const CompactIconPicker = forwardRef<HTMLDivElement, CompactIconPickerProps>(
  function CompactIconPicker({ value, onChange, portal, className, ...props }, ref) {
    const [open, setOpen] = useState(false);

    function handleChange(name: string | null) {
      onChange(name);
      if (name !== null) {
        setOpen(false);
      }
    }

    return (
      <div ref={ref} className={cn("inline-flex", className)} {...props}>
        <Popover open={open} onOpenChange={setOpen} placement="bottom-start" portal={portal}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={value ? `Selected icon: ${value}` : "Choose icon"}
              className={cn(
                "inline-flex items-center gap-r5 rounded-md px-r4 py-r5",
                "bg-surface-0 border border-border-strong",
                "text-body-2 cursor-pointer duration-fast",
                "hover:bg-surface-2 hover:border-fg-muted",
                "focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-0 focus:border-border-focus",
                "active:bg-surface-3 active:scale-[0.98]",
              )}
            >
              <span className={cn(
                "inline-flex items-center justify-center shrink-0",
                value ? "text-fg-primary" : "text-fg-muted",
              )}>
                {value ? (
                  <IconDisplay name={value} size={18} />
                ) : (
                  <Image size={18} />
                )}
              </span>
              <span className={cn(
                "whitespace-nowrap",
                value ? "text-fg-primary" : "text-fg-muted",
              )}>
                {value ?? "Choose icon"}
              </span>
            </button>
          </Popover.Trigger>
          <Popover.Content className="w-72 p-r5">
            <IconGrid value={value} onChange={handleChange} tooltipPortal={portal} />
          </Popover.Content>
        </Popover>
      </div>
    );
  }
);

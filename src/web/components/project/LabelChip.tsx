import type { TaskLabelInfo } from "@/shared/schemas/label";

interface LabelChipProps {
  label: TaskLabelInfo;
  /** Visual size variant: "sm" for board cards, "default" for detail panels */
  size?: "sm" | "default";
  className?: string;
}

/**
 * Renders a colored label chip. Reused across the board, task detail, and
 * label picker so the visual treatment stays consistent.
 */
export function LabelChip({ label: lbl, size = "default", className }: LabelChipProps) {
  if (size === "sm") {
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${className ?? ""}`}
        style={{
          backgroundColor: lbl.color + "20",
          color: lbl.color,
        }}
      >
        {lbl.name}
      </span>
    );
  }

  return (
    <span
      className={`task-label-picker__chip ${className ?? ""}`}
      style={{
        backgroundColor: lbl.color + "20",
        color: lbl.color,
      }}
    >
      {lbl.name}
    </span>
  );
}

import { Check, Settings, Tag } from "lucide-react";
import { useMemo, useState } from "react";

import type { TaskLabelInfo } from "@/shared/schemas/label";
import { SearchInput } from "@/web/components/form/SearchInput";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import { useToast } from "@/web/components/ui/ToastContext";
import {
  useAssignLabel,
  useLabels,
  useUnassignLabel,
} from "@/web/hooks/use-labels";

import { LabelChip } from "./LabelChip";
import { LabelManagementDialog } from "./LabelManagementDialog";

interface TaskLabelPickerProps {
  taskId: string;
  projectId: string;
  labels: TaskLabelInfo[];
  readOnly?: boolean;
}

export function TaskLabelPicker({
  taskId,
  projectId,
  labels: assignedLabels,
  readOnly = false,
}: TaskLabelPickerProps) {
  const { toast } = useToast();
  const { data: labelsData } = useLabels(projectId);
  const assignLabel = useAssignLabel(taskId, projectId);
  const unassignLabel = useUnassignLabel(taskId, projectId);
  const [search, setSearch] = useState("");
  const [managementOpen, setManagementOpen] = useState(false);

  const allLabels = useMemo(() => labelsData?.labels ?? [], [labelsData?.labels]);
  const assignedIds = new Set(assignedLabels.map((l) => l.id));

  const filteredLabels = useMemo(() => {
    if (!search.trim()) return allLabels;
    const q = search.toLowerCase();
    return allLabels.filter((l) => l.name.toLowerCase().includes(q));
  }, [allLabels, search]);

  async function toggle(labelId: string) {
    try {
      if (assignedIds.has(labelId)) {
        await unassignLabel.mutateAsync(labelId);
      } else {
        await assignLabel.mutateAsync(labelId);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update label", { variant: "error" });
    }
  }

  if (readOnly) {
    if (assignedLabels.length === 0) return null;
    return (
      <div className="task-label-picker__chips">
        {assignedLabels.map((lbl) => (
          <LabelChip key={lbl.id} label={lbl} />
        ))}
      </div>
    );
  }

  return (
    <>
      <Popover placement="bottom-start" portal={false}>
        <Popover.Trigger asChild>
          <button type="button" className="task-label-picker__trigger">
            <Tag size={14} />
            {assignedLabels.length > 0 ? (
              <span className="task-label-picker__chips">
                {assignedLabels.map((lbl) => (
                  <LabelChip key={lbl.id} label={lbl} />
                ))}
              </span>
            ) : (
              <span className="text-fg-muted">Labels</span>
            )}
          </button>
        </Popover.Trigger>
        <Popover.Content className="task-label-picker__popover">
          <Text variant="body-3" weight="semibold" className="mb-2">
            Labels
          </Text>

          {allLabels.length > 5 && (
            <SearchInput
              value={search}
              onChange={setSearch}
              size="sm"
              placeholder="Search labels..."
              className="mb-2"
            />
          )}

          <div className="task-label-picker__list">
            {filteredLabels.map((lbl) => {
              const isAssigned = assignedIds.has(lbl.id);
              return (
                <button
                  key={lbl.id}
                  type="button"
                  className={`task-label-picker__option ${isAssigned ? "task-label-picker__option--active" : ""}`}
                  onClick={() => void toggle(lbl.id)}
                  disabled={assignLabel.isPending || unassignLabel.isPending}
                >
                  <span
                    className="task-label-picker__swatch"
                    style={{ backgroundColor: lbl.color }}
                  />
                  <span className="task-label-picker__label-name truncate">
                    {lbl.name}
                  </span>
                  {isAssigned && (
                    <Check size={14} className="task-label-picker__check" />
                  )}
                </button>
              );
            })}

            {filteredLabels.length === 0 && (
              <Text variant="body-3" color="muted" className="py-2 text-center">
                {allLabels.length === 0
                  ? "No labels created yet"
                  : "No labels found"}
              </Text>
            )}
          </div>

          <button
            type="button"
            className="task-label-picker__manage"
            onClick={() => setManagementOpen(true)}
          >
            <Settings size={12} />
            Manage labels
          </button>
        </Popover.Content>
      </Popover>

      <LabelManagementDialog
        open={managementOpen}
        onClose={() => setManagementOpen(false)}
        projectId={projectId}
        labels={allLabels}
      />
    </>
  );
}

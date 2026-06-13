import {
  Settings,
  Tag,
} from "lucide-react";

import { Checkbox } from "@/web/components/form/Checkbox";
import { Badge } from "@/web/components/ui/Badge";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import { FILTER_NONE } from "@/web/hooks/use-task-filters";
import { toggleArrayValue } from "@/web/util/array";

/** Minimal label shape the filter needs — a structural subset of `Label`. */
export interface LabelFilterOption {
  id: string;
  name: string;
  color: string;
}

export interface LabelFilterProps {
  /** All labels available in the current scope (project or workspace). */
  options: LabelFilterOption[];
  /**
   * Selected label ids. May contain the {@link FILTER_NONE} sentinel, which
   * means "tasks with no labels" and OR-composes with real ids (see
   * `applyFilters` in `use-task-filters`).
   */
  selected: string[];
  /** Receives the complete next selection when an option is toggled. */
  onChange: (next: string[]) => void;
  /**
   * Opens label management. Provided by project-scoped owners (TaskFilterBar
   * owns the LabelManagementDialog, which needs a `projectId`); omitted at
   * workspace level (My Tasks), where the zero-labels state degrades to
   * explanatory text because labels can only be created inside a project.
   * There is no label-management page to link to — the dialog is the only
   * management surface.
   */
  onManageLabels?: () => void;
}

/**
 * Label filter popover, fully controlled via `selected`/`onChange`.
 *
 * Why controlled (unlike AssigneeFilter/StatusFilter, which still take the
 * project-scoped `UseTaskFiltersReturn`): the workspace-level My Tasks view
 * reuses this popover with non-URL-backed filter state, so the component must
 * not reach into `useTaskFilters` itself.
 *
 * The trigger always renders, even with zero labels. Hiding it (the old
 * behavior) made the bar's controls appear and disappear as labels were
 * created/deleted, and gave users no path to discover label filtering — the
 * empty-state popover instead explains the situation and (when project-scoped)
 * offers the management dialog in place.
 */
export function LabelFilter({
  options,
  selected,
  onChange,
  onManageLabels,
}: LabelFilterProps) {
  const isActive = selected.length > 0;

  function toggle(labelId: string) {
    onChange(toggleArrayValue(selected, labelId));
  }

  return (
    <Popover placement="bottom-start">
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`task-filter-bar__trigger ${isActive ? "task-filter-bar__trigger--active" : ""}`}
        >
          <Tag size={14} />
          Label
          {isActive && (
            <Badge variant="info" className="task-filter-bar__count">
              {selected.length}
            </Badge>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content className="task-filter-bar__popover">
        <Text variant="body-3" weight="semibold" className="mb-2">
          Filter by label
        </Text>
        {options.length === 0 ? (
          <div className="task-filter-bar__empty">
            <Text variant="body-3" color="muted">
              {onManageLabels
                ? "No labels in this project yet."
                : "No labels in this workspace yet. Create labels inside a project."}
            </Text>
            {onManageLabels && (
              <button
                type="button"
                className="task-filter-bar__manage"
                onClick={onManageLabels}
              >
                <Settings size={12} />
                Manage labels
              </button>
            )}
          </div>
        ) : (
          <div className="task-filter-bar__popover-list">
            <label className="task-filter-bar__option">
              <Checkbox
                checked={selected.includes(FILTER_NONE)}
                onChange={() => toggle(FILTER_NONE)}
              />
              <span
                className="inline-block size-2.5 rounded-full shrink-0 border border-dashed border-border-strong"
                aria-hidden="true"
              />
              <span className="truncate">No label</span>
            </label>
            {options.map((lbl) => (
              <label
                key={lbl.id}
                className="task-filter-bar__option"
              >
                <Checkbox
                  checked={selected.includes(lbl.id)}
                  onChange={() => toggle(lbl.id)}
                />
                <span
                  className="inline-block size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: lbl.color }}
                />
                <span className="truncate">{lbl.name}</span>
              </label>
            ))}
          </div>
        )}
      </Popover.Content>
    </Popover>
  );
}

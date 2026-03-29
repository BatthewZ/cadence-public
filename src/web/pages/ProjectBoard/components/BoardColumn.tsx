import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleCheckBig,
  MoreHorizontal,
  Palette,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { Input } from "@/web/components/form/Input";
import { Select } from "@/web/components/form/Select";
import { Row, Stack } from "@/web/components/layout";
import { Badge } from "@/web/components/ui/Badge";
import { Button } from "@/web/components/ui/Button";
import { Dialog } from "@/web/components/ui/Dialog";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { IconButton } from "@/web/components/ui/IconButton";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import { useToast } from "@/web/components/ui/ToastContext";
import { type Task, type TaskGroup, useProject } from "@/web/contexts/ProjectContext";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { TASK_GROUP_COLORS } from "@/web/util/task-display";

import { AddTaskInline } from "./AddTaskForm";
import { COLUMN_TASK_LIMIT, groupIdStr, sortByPosition, taskIdStr } from "./dnd-helpers";
import { SortableTaskCard } from "./TaskCard";

// ---------------------------------------------------------------------------
// SortableColumn
// ---------------------------------------------------------------------------

export function SortableColumn({
  group,
  tasks,
  overlay,
  canEditTasks = true,
  isProjectAdmin = true,
  hasActiveFilters = false,
  onClearFilters,
  selectedIds,
  onToggleSelect,
}: {
  group: TaskGroup;
  tasks: Task[];
  overlay?: boolean;
  canEditTasks?: boolean;
  isProjectAdmin?: boolean;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (taskId: string, e: MouseEvent) => void;
}) {
  const {
    project,
    taskGroups,
    updateTaskGroup,
    removeTaskGroup,
    updateTask: updateTaskInCtx,
  } = useProject();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [targetGroupId, setTargetGroupId] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const otherGroups = useMemo(
    () => taskGroups.filter((g) => g.id !== group.id),
    [taskGroups, group.id]
  );

  const [expanded, setExpanded] = useState(false);

  const sortedTasks = useMemo(() => sortByPosition(tasks), [tasks]);
  const hiddenCount = sortedTasks.length - COLUMN_TASK_LIMIT;
  const visibleTasks = useMemo(
    () => (expanded || hiddenCount <= 0 ? sortedTasks : sortedTasks.slice(0, COLUMN_TASK_LIMIT)),
    [sortedTasks, expanded, hiddenCount]
  );
  const visibleTaskIds = useMemo(() => visibleTasks.map((t) => taskIdStr(t.id)), [visibleTasks]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: groupIdStr(group.id),
    data: { type: "group", group },
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleRename = async () => {
    const name = renameValue.trim();
    if (!name || name === group.name || !project) {
      setIsRenaming(false);
      setRenameValue(group.name);
      return;
    }
    updateTaskGroup(group.id, { name });
    try {
      await api.patch(`/api/task-groups/${group.id}`, { name });
    } catch {
      updateTaskGroup(group.id, { name: group.name });
      toast("Failed to rename section", { variant: "error" });
      setRenameValue(group.name);
    }
    setIsRenaming(false);
  };

  const openDeleteDialog = () => {
    setTargetGroupId(otherGroups.length > 0 ? otherGroups[0].id : "");
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!project || !targetGroupId) return;
    setDeleting(true);
    try {
      await api.delete(`/api/task-groups/${group.id}?targetGroupId=${targetGroupId}`);
      // Move tasks to target group optimistically, then remove column
      for (const t of tasks) {
        updateTaskInCtx(t.id, { taskGroupId: targetGroupId });
      }
      removeTaskGroup(group.id);
      void qc.invalidateQueries({ queryKey: queryKeys.projects.taskGroups(project.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.projects.tasks(project.id) });
      setShowDeleteDialog(false);
    } catch {
      toast("Failed to delete section", { variant: "error" });
    } finally {
      setDeleting(false);
    }
  };

  const startRename = () => {
    setRenameValue(group.name);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Stop all keydown events from bubbling to the dnd-kit drag handle,
    // which would otherwise interpret space/enter as drag activation.
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      void handleRename();
    } else if (e.key === "Escape") {
      setIsRenaming(false);
      setRenameValue(group.name);
    }
  };

  const handleColorChange = async (color: string | null) => {
    setShowColorPicker(false);
    if (color === (group.color ?? null) || !project) return;
    updateTaskGroup(group.id, { color: color ?? undefined });
    try {
      await api.patch(`/api/task-groups/${group.id}`, { color });
    } catch {
      updateTaskGroup(group.id, { color: group.color ?? undefined });
      toast("Failed to update color", { variant: "error" });
    }
  };

  const handleToggleCompletionGroup = async () => {
    const newValue = !group.isCompletionGroup;
    updateTaskGroup(group.id, { isCompletionGroup: newValue });
    try {
      await api.patch(`/api/task-groups/${group.id}`, { isCompletionGroup: newValue });
    } catch {
      updateTaskGroup(group.id, { isCompletionGroup: !newValue });
      toast("Failed to update section", { variant: "error" });
    }
  };

  return (
    <>
      <div
        ref={overlay ? undefined : setNodeRef}
        style={overlay ? undefined : style}
        className={`flex flex-col w-[260px] min-w-[240px] sm:w-[300px] sm:min-w-[300px] flex-shrink-0 h-full rounded-lg bg-surface-1 ${
          overlay ? "shadow-xl rotate-3" : ""
        }`}
      >
        {/* Column header */}
        <div
          className="flex items-center gap-2 px-3 py-3 rounded-t-lg"
          {...(overlay ? {} : attributes)}
          {...(overlay ? {} : listeners)}
        >
          {isProjectAdmin ? (
            <Popover
              open={showColorPicker}
              onOpenChange={setShowColorPicker}
              placement="bottom-start"
            >
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className={`size-3 rounded-full shrink-0 cursor-pointer transition-shadow hover:ring-2 hover:ring-accent/50 ${
                    group.isCompletionGroup
                      ? "bg-status-success flex items-center justify-center"
                      : !group.color
                        ? "bg-fg-muted"
                        : ""
                  }`}
                  style={
                    !group.isCompletionGroup && group.color
                      ? { backgroundColor: group.color }
                      : undefined
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label="Change column color"
                >
                  {group.isCompletionGroup && <Check size={8} className="text-fg-inverse" />}
                </button>
              </Popover.Trigger>
              <Popover.Content className="!p-0">
                <div className="flex gap-1.5 p-2">
                  {TASK_GROUP_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="size-6 rounded-full cursor-pointer border-2 transition-all hover:scale-110"
                      style={{
                        backgroundColor: c,
                        borderColor: group.color === c ? "var(--color-fg-primary)" : "transparent",
                      }}
                      onClick={() => void handleColorChange(c)}
                      aria-label={`Select color ${c}`}
                    />
                  ))}
                  {group.color && (
                    <button
                      type="button"
                      className="size-6 rounded-full cursor-pointer border-2 border-border-default flex items-center justify-center hover:bg-surface-3 transition-all"
                      onClick={() => void handleColorChange(null)}
                      aria-label="Remove color"
                    >
                      <X size={12} className="text-fg-muted" />
                    </button>
                  )}
                </div>
              </Popover.Content>
            </Popover>
          ) : group.isCompletionGroup ? (
            <span className="size-3 rounded-full shrink-0 bg-status-success flex items-center justify-center">
              <Check size={8} className="text-fg-inverse" />
            </span>
          ) : group.color ? (
            <span
              className="size-3 rounded-full shrink-0"
              style={{ backgroundColor: group.color }}
            />
          ) : null}
          <div className="flex-1 min-w-0">
            {isRenaming ? (
              <Input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={() => void handleRename()}
                className="text-body-3 py-0 px-1 h-6"
              />
            ) : (
              <Text variant="body-2" weight="semibold" className="truncate cursor-grab">
                {group.name}
              </Text>
            )}
          </div>
          <Badge variant="default" className="shrink-0">
            {tasks.length}
          </Badge>
          {isProjectAdmin && (
            <DropdownMenu placement="bottom-end">
              <DropdownMenu.Trigger asChild>
                <IconButton
                  aria-label="Column actions"
                  className="size-6 shrink-0 p-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal size={14} />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item index={0} icon={<Pencil size={14} />} onSelect={startRename}>
                  Rename
                </DropdownMenu.Item>
                <DropdownMenu.Item index={1} icon={<Palette size={14} />} onSelect={() => setShowColorPicker(true)}>
                  Change color
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  index={2}
                  icon={<CircleCheckBig size={14} />}
                  onSelect={() => { void handleToggleCompletionGroup(); }}
                >
                  {group.isCompletionGroup ? "Unmark as done column" : "Set as done column"}
                </DropdownMenu.Item>
                <DropdownMenu.Divider />
                <DropdownMenu.Item index={3} variant="danger" icon={<Trash2 size={14} />} onSelect={openDeleteDialog}>
                  Delete section
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          )}
        </div>

        {/* Scrollable task list */}
        <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1.5">
          <SortableContext items={visibleTaskIds} strategy={verticalListSortingStrategy}>
            {sortedTasks.length === 0 ? (
              <div className="border-2 border-dashed border-border-default/40 rounded-lg py-8 flex flex-col items-center justify-center gap-2">
                <Text variant="body-3" color="muted">
                  {hasActiveFilters ? "No tasks match your filters" : "No tasks yet"}
                </Text>
                {hasActiveFilters && onClearFilters && (
                  <button
                    onClick={onClearFilters}
                    className="text-body-3 text-accent hover:text-accent-hover cursor-pointer transition-colors"
                  >
                    Clear filters
                  </button>
                )}
                {!hasActiveFilters && canEditTasks && (
                  <Text variant="body-3" color="muted" className="opacity-60">
                    Drop tasks here or use + below
                  </Text>
                )}
              </div>
            ) : (
              visibleTasks.map((task) => (
                <SortableTaskCard
                  key={task.id}
                  task={task}
                  selected={selectedIds?.has(task.id)}
                  onToggleSelect={onToggleSelect}
                />
              ))
            )}
          </SortableContext>
          {!expanded && hiddenCount > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-body-3 text-fg-muted hover:text-accent hover:bg-accent-subtle rounded-md transition-all cursor-pointer"
            >
              Show {hiddenCount} more task{hiddenCount !== 1 ? "s" : ""}
            </button>
          )}
          {canEditTasks && <AddTaskInline groupId={group.id} />}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)}>
        <Stack gap="r4" className="p-r2">
          <Text variant="h5" weight="semibold">
            Delete &ldquo;{group.name}&rdquo;
          </Text>

          {tasks.length > 0 ? (
            <>
              <Text variant="body-2" color="secondary">
                This section contains {tasks.length} task{tasks.length !== 1 ? "s" : ""}. Choose a
                section to move them to before deleting.
              </Text>
              <div>
                <Text variant="body-3" color="muted" className="mb-r6">
                  Move tasks to
                </Text>
                <Select value={targetGroupId} onChange={(e) => setTargetGroupId(e.target.value)}>
                  {otherGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          ) : (
            <Text variant="body-2" color="secondary">
              This section has no tasks. Select a fallback section in case tasks are added
              concurrently.
            </Text>
          )}

          {otherGroups.length === 0 && (
            <Text variant="body-2" color="muted">
              Cannot delete the only section in this project.
            </Text>
          )}

          <Row gap="r4" justify="end" className="pt-r3">
            <Button variant="ghost" size="md" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={!targetGroupId || deleting || otherGroups.length === 0}
              onClick={() => void handleDeleteConfirm()}
            >
              {deleting ? "Deleting..." : "Delete Section"}
            </Button>
          </Row>
        </Stack>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// ColumnOverlay (non-interactive clone for DragOverlay)
// ---------------------------------------------------------------------------

export function ColumnOverlay({ group, tasks }: { group: TaskGroup; tasks: Task[] }) {
  return <SortableColumn group={group} tasks={tasks} overlay />;
}

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import { generateKeyBetween } from "@/shared/lib/fractional-index";
import { BulkActionBar } from "@/web/components/ui/BulkActionBar";
import { QueryErrorRetry } from "@/web/components/ui/QueryErrorRetry";
import { useToast } from "@/web/components/ui/ToastContext";
import { type Task, useProject } from "@/web/contexts/ProjectContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useMultiSelect } from "@/web/hooks/use-multi-select";
import { useProjectPermissions } from "@/web/hooks/use-permissions";
import { useTaskFilters } from "@/web/hooks/use-task-filters";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

import { AddGroupColumn } from "./components/AddGroupColumn";
import { ColumnOverlay, SortableColumn } from "./components/BoardColumn";
import { BoardSkeletonColumns } from "./components/BoardSkeleton";
import {
  type ActiveItem,
  COLUMN_TASK_LIMIT,
  groupIdStr,
  parseId,
  sortByPosition,
} from "./components/dnd-helpers";
import { TaskCardOverlay } from "./components/TaskCard";

export { COLUMN_TASK_LIMIT } from "./components/dnd-helpers";

// ---------------------------------------------------------------------------
// Main Board
// ---------------------------------------------------------------------------

export default function ProjectBoard() {
  const {
    project,
    taskGroups,
    tasks,
    members,
    tasksError,
    taskGroupsError,
    refetchTasks,
    refetchTaskGroups,
    updateTask: ctxUpdateTask,
    updateTaskGroup: ctxUpdateTaskGroup,
  } = useProject();
  useDocumentTitle(`${project.name} — Board`);
  const { canEditTasks, isProjectAdmin } = useProjectPermissions(members);
  const { filteredTasks, hasActiveFilters, clearFilters } = useTaskFilters(tasks);
  const { toast } = useToast();
  const qcBoard = useQueryClient();

  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);

  // --- Multi-select ---
  const { selectedIds, handleToggleSelect, handleClearSelection } = useMultiSelect();

  // Sorted groups
  const sortedGroups = useMemo(() => sortByPosition(taskGroups), [taskGroups]);
  const groupIds = useMemo(() => sortedGroups.map((g) => groupIdStr(g.id)), [sortedGroups]);

  // Tasks grouped by taskGroupId (uses filtered tasks for display)
  const tasksByGroup = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const g of sortedGroups) {
      map[g.id] = [];
    }
    for (const t of filteredTasks) {
      if (map[t.taskGroupId]) {
        map[t.taskGroupId].push(t);
      }
    }
    return map;
  }, [filteredTasks, sortedGroups]);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(
    canEditTasks ? pointerSensor : undefined,
    canEditTasks ? keyboardSensor : undefined
  );

  // Find which group container a sortable id belongs to
  const findGroupForTask = useCallback(
    (id: string): string | null => {
      const parsed = parseId(id);
      if (parsed.type === "group") return parsed.id;
      // It's a task — find which group it belongs to
      const task = tasks.find((t) => t.id === parsed.id);
      return task?.taskGroupId ?? null;
    },
    [tasks]
  );

  // --- Drag handlers ---

  // Track the original group of a dragged task so handleDragEnd can detect
  // cross-column moves even when dnd-kit resolves over === active (which
  // happens because handleDragOver optimistically changes the task's group).
  const dragOriginGroupRef = useRef<string | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const parsed = parseId(active.id as string);

      if (parsed.type === "group") {
        const group = taskGroups.find((g) => g.id === parsed.id);
        if (group) setActiveItem({ type: "group", group });
      } else {
        const task = tasks.find((t) => t.id === parsed.id);
        if (task) {
          setActiveItem({ type: "task", task });
          dragOriginGroupRef.current = task.taskGroupId;
        }
      }
    },
    [taskGroups, tasks]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      const activeParsed = parseId(activeId);

      // Only handle cross-container task moves
      if (activeParsed.type !== "task") return;

      const activeGroupId = findGroupForTask(activeId);
      const overGroupId = findGroupForTask(overId);

      if (!activeGroupId || !overGroupId || activeGroupId === overGroupId) return;

      // Move task to new group optimistically
      ctxUpdateTask(activeParsed.id, { taskGroupId: overGroupId });
    },
    [findGroupForTask, ctxUpdateTask]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      const dragOriginGroupId = dragOriginGroupRef.current;
      setActiveItem(null);
      dragOriginGroupRef.current = null;

      if (!over) return;

      const activeParsed = parseId(active.id as string);
      const overParsed = parseId(over.id as string);

      // Skip no-op drops — but NOT if the task was moved across columns during
      // drag (handleDragOver optimistically changes taskGroupId, which can cause
      // dnd-kit to resolve over === active after a cross-column move)
      if (active.id === over.id) {
        if (activeParsed.type !== "task" || !dragOriginGroupId) return;
        const task = tasks.find((t) => t.id === activeParsed.id);
        if (!task || task.taskGroupId === dragOriginGroupId) return;
        // Task changed groups — fall through to make the API call
      }

      // --- Column reorder ---
      if (activeParsed.type === "group" && overParsed.type === "group") {
        const oldIndex = sortedGroups.findIndex((g) => g.id === activeParsed.id);
        const newIndex = sortedGroups.findIndex((g) => g.id === overParsed.id);

        if (oldIndex === -1 || newIndex === -1) return;

        const reordered = arrayMove(sortedGroups, oldIndex, newIndex);

        // Calculate new position
        const above = newIndex > 0 ? reordered[newIndex - 1] : null;
        const below = newIndex < reordered.length - 1 ? reordered[newIndex + 1] : null;
        const newPosition = generateKeyBetween(above?.position ?? null, below?.position ?? null);

        // Optimistic update via context
        ctxUpdateTaskGroup(activeParsed.id, { position: newPosition });

        try {
          await api.patch(`/api/task-groups/${activeParsed.id}/reorder`, {
            position: newPosition,
          });
        } catch {
          // Revert on failure — refetch from server
          ctxUpdateTaskGroup(activeParsed.id, { position: sortedGroups[oldIndex].position });
          toast("Failed to reorder section", { variant: "error" });
        }
        return;
      }

      // --- Task reorder / move ---
      if (activeParsed.type === "task") {
        const task = tasks.find((t) => t.id === activeParsed.id);
        if (!task) return;

        // Determine target group
        let targetGroupId: string;
        if (overParsed.type === "group") {
          targetGroupId = overParsed.id;
        } else {
          const overTask = tasks.find((t) => t.id === overParsed.id);
          targetGroupId = overTask?.taskGroupId ?? task.taskGroupId;
        }

        // Get tasks in target group, with active task already moved there
        const groupTasks = sortByPosition(
          tasks.filter((t) => t.taskGroupId === targetGroupId && t.id !== activeParsed.id)
        );

        // Find drop index
        // Since the active task is excluded from groupTasks, we need to account
        // for whether we're moving down (insert after the over item) or up (insert before).
        let dropIndex: number;
        if (overParsed.type === "group") {
          // Dropped on column header — place at end
          dropIndex = groupTasks.length;
        } else {
          const overIndex = groupTasks.findIndex((t) => t.id === overParsed.id);
          if (overIndex === -1) {
            dropIndex = groupTasks.length;
          } else {
            // If same group and the active task was originally above the over task,
            // we're dragging down — insert AFTER the over item
            const sameGroup = task.taskGroupId === targetGroupId;
            const wasAbove = sameGroup && task.position < (groupTasks[overIndex]?.position ?? "");
            dropIndex = wasAbove ? overIndex + 1 : overIndex;
          }
        }

        // Calculate position
        const above = dropIndex > 0 ? groupTasks[dropIndex - 1] : null;
        const below = dropIndex < groupTasks.length ? groupTasks[dropIndex] : null;
        const newPosition = generateKeyBetween(above?.position ?? null, below?.position ?? null);

        // Optimistic update via context — also handle completion state
        const oldGroupId = task.taskGroupId;
        const oldPosition = task.position;
        const oldCompleted = task.completed;
        const targetGroup = sortedGroups.find((g) => g.id === targetGroupId);
        const optimisticCompleted = targetGroup?.isCompletionGroup ?? task.completed;
        ctxUpdateTask(activeParsed.id, {
          taskGroupId: targetGroupId,
          position: newPosition,
          completed: optimisticCompleted,
        });

        try {
          const res = await api.patch<{ task: Task }>(`/api/tasks/${activeParsed.id}/move`, {
            taskGroupId: targetGroupId,
            position: newPosition,
          });
          // Apply full server state (includes completedAt, completedBy)
          ctxUpdateTask(activeParsed.id, res.task);
          void qcBoard.invalidateQueries({ queryKey: queryKeys.tasks.detail(activeParsed.id) });
          void qcBoard.invalidateQueries({ queryKey: queryKeys.projects.dashboard(project.id) });
        } catch {
          // Revert
          ctxUpdateTask(activeParsed.id, {
            taskGroupId: oldGroupId,
            position: oldPosition,
            completed: oldCompleted,
          });
          toast("Failed to move task", { variant: "error" });
        }
      }
    },
    [sortedGroups, tasks, toast, ctxUpdateTask, ctxUpdateTaskGroup, qcBoard, project.id]
  );

  // --- Render overlay ---

  const renderOverlay = () => {
    if (!activeItem) return null;
    if (activeItem.type === "task") {
      return <TaskCardOverlay task={activeItem.task} />;
    }
    const allGroupTasks = tasksByGroup[activeItem.group.id] ?? [];
    const cappedTasks = sortByPosition(allGroupTasks).slice(0, COLUMN_TASK_LIMIT);
    return <ColumnOverlay group={activeItem.group} tasks={cappedTasks} />;
  };

  // Show error state when board data queries fail
  if (tasksError || taskGroupsError) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-3 sm:p-4">
        <QueryErrorRetry
          message="Failed to load board data."
          onRetry={() => {
            if (taskGroupsError) refetchTaskGroups();
            if (tasksError) refetchTasks();
          }}
        />
      </div>
    );
  }

  // Show skeleton columns when task groups haven't loaded yet
  if (taskGroups.length === 0 && tasks.length === 0 && !sortedGroups.length) {
    return (
      <div className="flex h-full min-h-0 overflow-x-auto gap-3 p-3 sm:gap-5 sm:p-4">
        <BoardSkeletonColumns />
        {isProjectAdmin && <AddGroupColumn />}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-x-auto gap-3 p-3 sm:gap-5 sm:p-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={(event) => { void handleDragEnd(event); }}
      >
        <SortableContext items={groupIds} strategy={horizontalListSortingStrategy}>
          {sortedGroups.map((group) => (
            <SortableColumn
              key={group.id}
              group={group}
              tasks={tasksByGroup[group.id] ?? []}
              canEditTasks={canEditTasks}
              isProjectAdmin={isProjectAdmin}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearFilters}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
            />
          ))}
        </SortableContext>
        <DragOverlay dropAnimation={null}>{activeItem && renderOverlay()}</DragOverlay>
      </DndContext>
      {isProjectAdmin && <AddGroupColumn />}
      <BulkActionBar selectedIds={selectedIds} onClearSelection={handleClearSelection} />
    </div>
  );
}

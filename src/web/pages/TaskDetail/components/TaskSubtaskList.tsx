import type { SensorDescriptor, SensorOptions } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";

import { Input } from "@/web/components/form/Input";
import { TaskCheckbox } from "@/web/components/form/TaskCheckbox";
import { Row, Stack } from "@/web/components/layout";
import { Text } from "@/web/components/ui/Text";
import type { Subtask } from "@/web/contexts/ProjectContext";

import { SortableSubtaskRow } from "./SortableSubtaskRow";

interface TaskSubtaskListProps {
  subtaskSensors: SensorDescriptor<SensorOptions>[];
  sortedSubtasks: Subtask[];
  subtaskIds: string[];
  activeSubtask: Subtask | null;
  newSubtaskTitle: string;
  setNewSubtaskTitle: (value: string) => void;
  onToggle: (subtask: Subtask) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onRename: (id: string, title: string) => void | Promise<void>;
  onAddSubtask: () => void | Promise<void>;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void | Promise<void>;
  canEdit: boolean;
}

/**
 * Shared subtask list with drag-and-drop reordering, used by both
 * TaskDetailPanelInner and TaskDetailDialog. All state and handlers
 * are provided via props (sourced from the useTaskSubtasks hook),
 * keeping this component a pure presentation layer.
 */
export function TaskSubtaskList({
  subtaskSensors,
  sortedSubtasks,
  subtaskIds,
  activeSubtask,
  newSubtaskTitle,
  setNewSubtaskTitle,
  onToggle,
  onDelete,
  onRename,
  onAddSubtask,
  onDragStart,
  onDragEnd,
  canEdit,
}: TaskSubtaskListProps) {
  return (
    <Stack gap="r6">
      <DndContext
        sensors={subtaskSensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={(event) => {
          void onDragEnd(event);
        }}
      >
        <SortableContext items={subtaskIds} strategy={verticalListSortingStrategy}>
          {sortedSubtasks.map((subtask) => (
            <SortableSubtaskRow
              key={subtask.id}
              subtask={subtask}
              onToggle={(s) => {
                void onToggle(s);
              }}
              onDelete={(id) => {
                void onDelete(id);
              }}
              onRename={(id, title) => {
                void onRename(id, title);
              }}
              readOnly={!canEdit}
            />
          ))}
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeSubtask && (
            <Row
              gap="r5"
              align="center"
              className="px-r5 py-r6 rounded bg-surface-1 shadow-md"
            >
              <GripVertical size={14} className="shrink-0 text-fg-muted" />
              <TaskCheckbox
                checked={activeSubtask.completed}
                onChange={() => {}}
                size="sm"
              />
              <Text variant="body-2" className="flex-1">
                {activeSubtask.title}
              </Text>
            </Row>
          )}
        </DragOverlay>
      </DndContext>

      {canEdit && (
        <Input
          value={newSubtaskTitle}
          onChange={(e) => setNewSubtaskTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void onAddSubtask();
            }
          }}
          enterKeyHint="done"
          placeholder="+ Add subtask"
          className="border-dashed border-border-default bg-transparent py-1.5 px-r5 text-body-3 rounded"
        />
      )}
    </Stack>
  );
}

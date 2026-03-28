import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useRef, useState } from "react";

import { TaskCheckbox } from "@/web/components/form/TaskCheckbox";
import { Row } from "@/web/components/layout";
import { HoldToDeleteButton } from "@/web/components/ui/HoldToDeleteButton";
import { Text } from "@/web/components/ui/Text";
import type { Subtask } from "@/web/contexts/ProjectContext";

export function SortableSubtaskRow({
  subtask,
  onToggle,
  onDelete,
  onRename,
  readOnly,
}: {
  subtask: Subtask;
  onToggle: (subtask: Subtask) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  readOnly?: boolean;
}) {
  const isOptimistic = subtask.id.startsWith("optimistic-");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: subtask.id,
    disabled: isOptimistic,
  });

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(subtask.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function commitEdit() {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== subtask.title) {
      onRename(subtask.id, trimmed);
    } else {
      setEditValue(subtask.title);
    }
  }

  return (
    <Row
      ref={setNodeRef}
      style={style}
      gap="r5"
      align="center"
      className={`group px-r5 py-r6 -mx-r5 rounded hover:bg-surface-1 duration-fast ${
        isDragging ? "opacity-50 bg-surface-1 z-10 relative" : ""
      }`}
    >
      {!readOnly && (
        <button
          type="button"
          className="shrink-0 cursor-grab text-fg-muted opacity-0 group-hover:opacity-100 transition-opacity active:cursor-grabbing touch-none"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
      )}
      <TaskCheckbox
        checked={subtask.completed}
        onChange={() => onToggle(subtask)}
        size="sm"
        disabled={readOnly}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setEditValue(subtask.title);
              setEditing(false);
            }
          }}
          className="flex-1 min-w-0 bg-transparent border-b border-border-strong text-body-2 outline-none py-0"
          autoFocus
        />
      ) : (
        <Text
          variant="body-2"
          className={`flex-1 cursor-text ${
            subtask.completed
              ? "line-through text-fg-muted transition-all duration-fast"
              : "transition-all duration-fast"
          }`}
          onDoubleClick={
            readOnly
              ? undefined
              : () => {
                  setEditValue(subtask.title);
                  setEditing(true);
                }
          }
        >
          {subtask.title}
        </Text>
      )}
      {!readOnly && (
        <HoldToDeleteButton
          onDelete={() => onDelete(subtask.id)}
          label={`Hold to delete subtask "${subtask.title}"`}
        />
      )}
    </Row>
  );
}

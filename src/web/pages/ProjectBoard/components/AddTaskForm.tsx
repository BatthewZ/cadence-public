import { Plus as PlusIcon } from "lucide-react";
import {
  type KeyboardEvent,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

import { generateKeyBetween } from "@/shared/lib/fractional-index";
import { Input } from "@/web/components/form/Input";
import { useToast } from "@/web/components/ui/ToastContext";
import { type Task, useProject } from "@/web/contexts/ProjectContext";
import { api } from "@/web/lib/api/client";

import { sortByPosition } from "./dnd-helpers";

// ---------------------------------------------------------------------------
// AddTaskInline
// ---------------------------------------------------------------------------

export function AddTaskInline({ groupId }: { groupId: string }) {
  const { project, tasks, addTask } = useProject();
  const { toast } = useToast();
  const [, setSearchParams] = useSearchParams();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const [validationError, setValidationError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = () => {
    setIsEditing(true);
    // Focus on next tick after render
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setValue("");
    setValidationError("");
  };

  const handleSubmit = async () => {
    const title = value.trim();
    if (!title || !project) {
      if (!title) {
        setValidationError("Task name is required");
        inputRef.current?.focus();
      }
      return;
    }
    setValidationError("");

    // Calculate position: after last task in this group
    const groupTasks = sortByPosition(tasks.filter((t) => t.taskGroupId === groupId));
    const lastPos = groupTasks.length > 0 ? groupTasks[groupTasks.length - 1].position : null;
    const position = generateKeyBetween(lastPos, null);

    try {
      const res = await api.post<{ task: Task }>(`/api/projects/${project.id}/tasks`, {
        title,
        taskGroupId: groupId,
        position,
      });
      addTask(res.task);
      setValue("");
      // Open the new task's detail panel
      setSearchParams({ task: res.task.id });
    } catch {
      toast("Failed to create task", { variant: "error" });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  if (!isEditing) {
    return (
      <button
        onClick={handleOpen}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-body-2 text-fg-muted hover:text-accent hover:bg-accent-subtle rounded-md transition-all cursor-pointer"
      >
        <PlusIcon size={14} className="shrink-0" />
        Add task
      </button>
    );
  }

  return (
    <div className="px-0.5">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (validationError) setValidationError("");
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!value.trim()) handleCancel();
        }}
        placeholder="Task name..."
        className="text-body-3"
        error={!!validationError}
      />
      {validationError && <p className="text-body-3 text-error mt-1">{validationError}</p>}
    </div>
  );
}

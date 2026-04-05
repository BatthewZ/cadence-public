import { Plus as PlusIcon } from "lucide-react";
import {
  type KeyboardEvent,
  useRef,
  useState,
} from "react";

import { generateKeyBetween } from "@/shared/lib/fractional-index";
import { Input } from "@/web/components/form/Input";
import { Text } from "@/web/components/ui/Text";
import { useToast } from "@/web/components/ui/ToastContext";
import { type TaskGroup, useProject } from "@/web/contexts/ProjectContext";
import { api } from "@/web/lib/api/client";

import { sortByPosition } from "./dnd-helpers";

// ---------------------------------------------------------------------------
// AddGroupColumn
// ---------------------------------------------------------------------------

export function AddGroupColumn() {
  const { project, taskGroups, addTaskGroup } = useProject();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = () => {
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setValue("");
  };

  const handleSubmit = async () => {
    const name = value.trim();
    if (!name || !project) return;

    const sorted = sortByPosition(taskGroups);
    const lastPos = sorted.length > 0 ? sorted[sorted.length - 1].position : null;
    const position = generateKeyBetween(lastPos, null);

    try {
      const res = await api.post<{ taskGroup: TaskGroup }>(
        `/api/projects/${project.id}/task-groups`,
        { name, position }
      );
      addTaskGroup(res.taskGroup);
      setValue("");
      setIsEditing(false);
    } catch {
      toast("Failed to create section", { variant: "error" });
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

  return (
    <div className="flex flex-col w-[16.25rem] min-w-[15rem] sm:w-[18.75rem] sm:min-w-[18.75rem] flex-shrink-0 h-full rounded-lg border border-dashed border-border-default/50 hover:border-accent/40 bg-surface-1/30 hover:bg-surface-1/60 transition-all">
      {isEditing ? (
        <div className="p-3">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!value.trim()) handleCancel();
            }}
            placeholder="Section name..."
            className="text-body-3"
          />
        </div>
      ) : (
        <button
          onClick={handleOpen}
          className="flex items-center justify-center gap-1.5 h-full w-full text-fg-muted hover:text-accent transition-colors rounded-lg cursor-pointer"
        >
          <PlusIcon size={16} />
          <Text variant="body-2" as="span">
            Add Section
          </Text>
        </button>
      )}
    </div>
  );
}

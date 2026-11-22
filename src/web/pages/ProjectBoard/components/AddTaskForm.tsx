import { useQueryClient } from "@tanstack/react-query";
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
import { apiErrorMessage } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { sendWrite } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";

// ---------------------------------------------------------------------------
// AddTaskInline
// ---------------------------------------------------------------------------

/** The card shown until the server's row arrives; mirrors the defaults of the API's createTask. */
function optimisticTask({
  id,
  title,
  groupId,
  groupTasks,
  isCompletionGroup,
  creator,
  autoAssignCreator,
}: {
  id: string;
  title: string;
  groupId: string;
  groupTasks: Task[];
  isCompletionGroup: boolean;
  creator: { id: string; name: string; image?: string | null } | undefined;
  autoAssignCreator: boolean;
}): Task {
  const assignee = autoAssignCreator ? creator : undefined;
  const lastPosition = groupTasks.reduce<string | null>(
    (max, t) => (max === null || t.position > max ? t.position : max),
    null,
  );
  return {
    id,
    title,
    description: null,
    taskGroupId: groupId,
    assigneeId: assignee?.id ?? null,
    assigneeName: assignee?.name,
    assigneeAvatarUrl: assignee?.image ?? undefined,
    priority: "none",
    completed: isCompletionGroup,
    completedAt: isCompletionGroup ? new Date().toISOString() : null,
    completedBy: isCompletionGroup ? (creator?.id ?? null) : null,
    startDate: null,
    dueDate: null,
    cost: null,
    position: generateKeyBetween(lastPosition, null),
    icon: null,
    coverImageKey: null,
    coverUnsplash: null,
    coverImagePosition: null,
    subtaskCount: 0,
    subtaskCompletedCount: 0,
    commentCount: 0,
    attachmentCount: 0,
    labels: [],
    recurrenceRule: null,
    recurrenceParentId: null,
    recurrenceSeriesId: null,
  };
}

export function AddTaskInline({ groupId }: { groupId: string }) {
  const { project, tasks, taskGroups, addTask, removeTask } = useProject();
  const { data: session } = useSession();
  const qc = useQueryClient();
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

    const task = optimisticTask({
      id: crypto.randomUUID(),
      title,
      groupId,
      groupTasks: tasks.filter((t) => t.taskGroupId === groupId),
      isCompletionGroup: taskGroups.find((g) => g.id === groupId)?.isCompletionGroup ?? false,
      creator: session?.user,
      autoAssignCreator: project.autoAssignCreator ?? false,
    });
    addTask(task);
    freshnessTracker.recordMutation("tasks");
    setValue("");

    // Functional updater that only SETS `task` — the object form
    // `setSearchParams({ task: ... })` replaces the whole query string, silently
    // wiping any active filter params. The panel's close handler deletes only
    // `task`, so the user's filters must survive the open (see
    // TaskCard.handleClick for the same rule).
    const openDetail = () =>
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("task", task.id);
        return next;
      });

    try {
      const result = await sendWrite<{ task: Task }>({
        method: "POST",
        path: `/api/projects/${project.id}/tasks`,
        body: { id: task.id, title, taskGroupId: groupId },
        label: `Create “${title}”`,
      });
      if (result.status === "sent") {
        addTask(result.data.task);
      } else {
        // The detail query can't fetch a task the server doesn't have yet; seed it from the card.
        const detail: TaskDetail = { ...task, subtasks: [], commentCount: 0, projectId: project.id };
        qc.setQueryData(queryKeys.tasks.detail(task.id), { task: detail });
      }
      openDetail();
    } catch (err) {
      removeTask(task.id);
      setValue((current) => current || title);
      toast(apiErrorMessage(err, "Failed to create task"), { variant: "error" });
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

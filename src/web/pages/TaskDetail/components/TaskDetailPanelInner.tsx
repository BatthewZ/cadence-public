import {
  closestCenter,
  DndContext,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  Copy,
  GripVertical,
  Pencil,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Input } from "@/web/components/form/Input";
import { MentionTextarea } from "@/web/components/form/MentionTextarea";
import { TaskCheckbox } from "@/web/components/form/TaskCheckbox";
import { Textarea } from "@/web/components/form/Textarea";
import { Divider, Row, Stack } from "@/web/components/layout";
import { TaskLabelPicker } from "@/web/components/project/TaskLabelPicker";
import { useAppShell } from "@/web/components/ui/AppShell";
import { Avatar } from "@/web/components/ui/Avatar";
import { Button } from "@/web/components/ui/Button";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { CoverImage } from "@/web/components/ui/CoverImage";
import { HoldToDeleteButton } from "@/web/components/ui/HoldToDeleteButton";
import { IconButton } from "@/web/components/ui/IconButton";
import { IconDisplay } from "@/web/components/ui/IconDisplay";
import { IconGrid } from "@/web/components/ui/IconPicker";
import { MentionText } from "@/web/components/ui/MentionText";
import { Popover } from "@/web/components/ui/Popover";
import { CommentSkeletonList, Skeleton } from "@/web/components/ui/Skeleton";
import { Text } from "@/web/components/ui/Text";
import type { ToastAction } from "@/web/components/ui/Toast";
import type { Comment, Subtask, Task } from "@/web/contexts/ProjectContext";
import { useProject } from "@/web/contexts/ProjectContext";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useProjectPermissions } from "@/web/hooks/use-permissions";
import {
  type CommentsPage,
  optimisticAddComment,
  optimisticUpdateComment,
  rollbackAddComment,
  rollbackUpdateComment,
  useTaskComments,
} from "@/web/hooks/use-task-comments";
import { useTaskCover } from "@/web/hooks/use-task-cover";
import { useTaskEditing } from "@/web/hooks/use-task-editing";
import { useTaskSubtasks } from "@/web/hooks/use-task-subtasks";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { queryKeys } from "@/web/lib/query-keys";
import { TaskActivityFeed } from "@/web/pages/TaskDetail/TaskActivityFeed";
import { TaskAttachmentSection } from "@/web/pages/TaskDetail/TaskAttachmentSection";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";
import { cn } from "@/web/util/style/style";

import {
  AssigneePicker,
  AssigneePickerReadOnly,
  GroupPicker,
  GroupPickerReadOnly,
  PriorityPicker,
  PriorityPickerReadOnly,
} from "./PropertyEditors";
import { PropertyRow } from "./PropertyRow";
import { RecurrencePicker, RecurrencePickerReadOnly } from "./RecurrencePicker";
import { SortableSubtaskRow } from "./SortableSubtaskRow";

export function TaskDetailPanelInner({
  taskId,
  panelRef,
  members,
  toast,
  onClose,
  visible,
}: {
  taskId: string;
  panelRef: React.RefObject<HTMLDivElement | null>;
  members: WorkspaceMember[];
  toast: (
    message: string,
    options?: {
      variant?: "info" | "success" | "warning" | "error";
      duration?: number;
      action?: ToastAction;
    }
  ) => string;
  onClose: () => void;
  visible: boolean;
}) {
  const {
    addTask: addTaskToContext,
    updateTask: updateTaskInContext,
    removeTask: removeTaskFromContext,
    project,
    taskGroups,
    refetchTasks,
    members: projectMembers,
  } = useProject();
  const { isMobile } = useAppShell();
  const { workspace } = useWorkspace();
  const { canEditTasks } = useProjectPermissions(projectMembers);
  const qc = useQueryClient();
  const {
    data: taskData,
    isLoading: loading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.tasks.detail(taskId),
    queryFn: () => api.get<{ task: TaskDetail }>(`/api/tasks/${taskId}`),
  });
  const error = queryError?.message ?? null;

  const {
    comments: paginatedComments,
    isLoading: isCommentsLoading,
    isError: isCommentsError,
    fetchNextPage: fetchNextComments,
    hasNextPage: hasMoreComments,
    isFetchingNextPage: isFetchingMoreComments,
  } = useTaskComments(taskId);

  // Local optimistic copy of the task — seeded from API, updated optimistically
  const [localTask, setLocalTask] = useState<TaskDetail | null>(null);
  const task = localTask;

  // Seed local task from API data (only on initial load or taskId change)
  useEffect(() => {
    if (taskData?.task) {
      const incoming = taskData.task;
      // Defer to avoid synchronous setState in effect body
      queueMicrotask(() => {
        setLocalTask((prev) => {
          // Only overwrite if this is a fresh load (no local state yet) or a refetch after subtask/comment changes
          if (!prev || prev.id !== incoming.id) return incoming;
          // Merge in server-managed fields but keep locally-edited fields
          return {
            ...prev,
            subtasks: incoming.subtasks,
            commentCount: incoming.commentCount,
            labels: incoming.labels,
          };
        });
      });
    }
  }, [taskData]);

  const invalidateTaskQueries = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
    void qc.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId) });
  }, [qc, taskId]);

  // Mutations
  const patchTask = useMutation({
    mutationFn: (updates: Partial<TaskDetail>) =>
      api.patch<{ task: TaskDetail }>(`/api/tasks/${taskId}`, updates),
    onSuccess: invalidateTaskQueries,
  });
  const deleteTaskMutation = useMutation({
    mutationFn: () => api.delete<{ ok: boolean }>(`/api/tasks/${taskId}`),
  });
  const createSubtask = useMutation({
    mutationFn: (input: { title: string }) =>
      api.post<{ subtask: Subtask }>(`/api/tasks/${taskId}/subtasks`, input),
    onSettled: invalidateTaskQueries,
  });
  const createComment = useMutation({
    mutationFn: (input: { body: string }) =>
      api.post<{ comment: Comment }>(`/api/tasks/${taskId}/comments`, input),
    onSettled: invalidateTaskQueries,
  });
  const updateCommentMutation = useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      api.patch<{ comment: Comment }>(`/api/comments/${commentId}`, { body }),
    onSettled: invalidateTaskQueries,
  });
  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => api.delete<{ ok: boolean }>(`/api/comments/${commentId}`),
    onSettled: invalidateTaskQueries,
  });

  // Subtask DnD, CRUD, and optimistic updates
  const {
    subtaskSensors,
    sortedSubtasks,
    subtaskIds,
    activeSubtask,
    newSubtaskTitle,
    setNewSubtaskTitle,
    handleSubtaskToggle,
    handleAddSubtask,
    handleDeleteSubtask,
    handleRenameSubtask,
    handleSubtaskDragStart,
    handleSubtaskDragEnd,
  } = useTaskSubtasks({
    taskId,
    localTask,
    setLocalTask,
    updateTaskInContext,
    invalidateTaskQueries,
    toast,
    createSubtask,
  });

  // Cover image upload, removal, and position changes
  const patchTaskMutateAsync = patchTask.mutateAsync;
  const {
    coverUploading,
    handleCoverUpload,
    handleCoverRemove,
    handleCoverPositionChange,
  } = useTaskCover({
    taskId,
    setLocalTask,
    updateTaskInContext,
    invalidateTaskQueries,
    patchTaskMutateAsync,
    toast,
    refetch,
  });

  // Title, description, cost editing with dirty-field tracking
  const {
    dirtyFields,
    editingTitle,
    setEditingTitle,
    titleValue,
    setTitleValue,
    descriptionValue,
    setDescriptionValue,
    costDisplay,
    setCostDisplay,
    handlePatch,
    handleTitleSave,
    handleDescriptionBlur,
    handleCostBlur,
  } = useTaskEditing({
    taskId,
    localTask,
    setLocalTask,
    updateTaskInContext,
    patchTaskMutateAsync,
    toast,
    refetch,
    taskData,
  });

  // Current user
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  // Local state for comments, deletion dialog, and URL params
  const [commentBody, setCommentBody] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [, setSearchParams] = useSearchParams();

  // Reset all local state when switching tasks (replaces key={taskId} remount)
  // Also re-seed from cache if data is already available (React Query may serve cached data
  // immediately, so the seed effect below won't fire if taskData hasn't changed).
  useEffect(() => {
    const cached = qc.getQueryData<{ task: TaskDetail }>(queryKeys.tasks.detail(taskId));
    dirtyFields.current.clear();
    // Defer to avoid synchronous setState in effect body
    queueMicrotask(() => {
      setLocalTask(cached?.task ?? null);
      setEditingTitle(false);
      setTitleValue(cached?.task?.title ?? "");
      setDescriptionValue(cached?.task?.description ?? "");
      setCostDisplay(cached?.task?.cost != null ? (cached.task.cost / 100).toFixed(2) : "");
      setNewSubtaskTitle("");
      setCommentBody("");
      setEditingCommentId(null);
      setEditingCommentBody("");
      setShowDeleteDialog(false);
    });
  }, [taskId, qc, dirtyFields, setEditingTitle, setTitleValue, setDescriptionValue, setCostDisplay, setNewSubtaskTitle]);

  // Keyboard escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleAddComment() {
    if (!commentBody.trim()) return;
    const body = commentBody.trim();
    setCommentBody("");

    const optimisticComment = optimisticAddComment(qc, taskId, {
      body,
      authorId: currentUserId ?? "",
      authorName: session?.user?.name ?? "",
    });
    updateTaskInContext(taskId, { commentCount: (task?.commentCount ?? 0) + 1 });

    try {
      await createComment.mutateAsync({ body });
    } catch {
      rollbackAddComment(qc, taskId, optimisticComment.id);
      updateTaskInContext(taskId, { commentCount: Math.max(0, (task?.commentCount ?? 1) - 1) });
      setCommentBody(body);
      toast("Failed to add comment", { variant: "error" });
    }
  }

  async function handleUpdateComment(commentId: string) {
    const body = editingCommentBody.trim();
    if (!body) return;
    setEditingCommentId(null);

    const oldBody = optimisticUpdateComment(qc, taskId, commentId, body);

    try {
      await updateCommentMutation.mutateAsync({ commentId, body });
    } catch {
      rollbackUpdateComment(qc, taskId, commentId, oldBody);
      toast("Failed to update comment", { variant: "error" });
    }
  }

  async function handleDeleteComment(commentId: string) {
    const removedComment = paginatedComments.find((c) => c.id === commentId);
    if (!removedComment) return;

    // Optimistically remove from cache
    qc.setQueryData<{ pages: CommentsPage[]; pageParams: unknown[] }>(
      queryKeys.tasks.comments(taskId),
      (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            comments: page.comments.filter((c) => c.id !== commentId),
          })),
        };
      }
    );
    updateTaskInContext(taskId, { commentCount: Math.max(0, (task?.commentCount ?? 1) - 1) });

    try {
      await deleteCommentMutation.mutateAsync(commentId);
    } catch {
      // Restore on failure
      qc.setQueryData<{ pages: CommentsPage[]; pageParams: unknown[] }>(
        queryKeys.tasks.comments(taskId),
        (old) => {
          if (!old) return old;
          const pages = [...old.pages];
          const lastIdx = pages.length - 1;
          pages[lastIdx] = {
            ...pages[lastIdx],
            comments: [...pages[lastIdx].comments, removedComment],
          };
          return { ...old, pages };
        }
      );
      updateTaskInContext(taskId, { commentCount: (task?.commentCount ?? 0) + 1 });
      toast("Failed to delete comment", { variant: "error" });
    }
  }

  async function handleDuplicateTask() {
    try {
      const result = await api.post<{ task: Task }>(`/api/tasks/${taskId}/duplicate`, {});
      addTaskToContext(result.task);
      refetchTasks();
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspace.id) });
      toast("Task duplicated", { variant: "success" });
    } catch {
      toast("Failed to duplicate task", { variant: "error" });
    }
  }

  async function handleDeleteTask() {
    try {
      await deleteTaskMutation.mutateAsync();
      setShowDeleteDialog(false);
      // Cancel task queries to prevent 404 refetches while panel unmounts
      await qc.cancelQueries({ queryKey: ["tasks", taskId] });
      // Clear task from URL (triggers panel unmount)
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("task");
        return next;
      });
      removeTaskFromContext(taskId);
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspace.id) });
    } catch {
      toast("Failed to delete task", { variant: "error" });
    }
  }

  async function handleToggleComplete() {
    if (!task) return;
    const wasCompleted = task.completed;
    setLocalTask((prev) => (prev ? { ...prev, completed: !wasCompleted } : prev));
    updateTaskInContext(taskId, { completed: !wasCompleted });
    const endpoint = wasCompleted
      ? `/api/tasks/${taskId}/uncomplete`
      : `/api/tasks/${taskId}/complete`;
    try {
      const res = await api.post<{ task: Task; nextRecurringTask?: Task }>(endpoint, {});
      setLocalTask((prev) => (prev ? { ...prev, ...res.task } : prev));
      updateTaskInContext(taskId, res.task);
      if (res.nextRecurringTask) {
        addTaskToContext(res.nextRecurringTask);
        toast("Next occurrence created", { variant: "success" });
      }
      void qc.invalidateQueries({ queryKey: queryKeys.projects.dashboard(project.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboardMyTasksPrefix(workspace.id) });
    } catch {
      setLocalTask((prev) =>
        prev ? { ...prev, completed: wasCompleted } : prev
      );
      updateTaskInContext(taskId, { completed: wasCompleted });
      toast("Failed to update task", { variant: "error" });
    }
  }

  return (
    <>
      <div
        ref={panelRef}
        className={`fixed inset-y-0 right-0 w-full sm:w-120 max-w-full bg-surface-0 shadow-xl border-l border-(--C-BORDER)/30 z-40 flex flex-col overflow-hidden transition-transform duration-200 ease-out ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Cover Image */}
        {task && (
          <CoverImage
            coverUrl={task.coverImageKey ? `/api/uploads/${task.coverImageKey}` : null}
            onUpload={(file: File) => {
              void handleCoverUpload(file);
            }}
            onRemove={() => {
              void handleCoverRemove();
            }}
            uploading={coverUploading}
            editable={canEditTasks}
            position={task.coverImagePosition}
            onPositionChange={(pos) => { void handleCoverPositionChange(pos); }}
            roundedTop={false}
          />
        )}

        {/* Header */}
        <div className="flex items-center gap-r5 px-r3 py-r5 shrink-0 border-b border-border-default">
          {/* Icon picker inline with title */}
          {task && canEditTasks && (
            <Popover placement="bottom-start">
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="shrink-0 inline-flex items-center justify-center size-8 rounded hover:bg-surface-2 active:bg-surface-3 duration-fast cursor-pointer text-fg-secondary"
                  aria-label={task.icon ? `Task icon: ${task.icon}` : "Add icon"}
                >
                  {task.icon ? <IconDisplay name={task.icon} size={20} /> : <SmilePlus size={20} />}
                </button>
              </Popover.Trigger>
              <Popover.Content className="w-72 p-r5">
                <IconGrid
                  value={task.icon ?? null}
                  onChange={(icon) => {
                    void handlePatch({ icon });
                  }}
                />
              </Popover.Content>
            </Popover>
          )}
          {task && !canEditTasks && task.icon && (
            <span className="shrink-0 inline-flex items-center justify-center size-8 text-fg-secondary">
              <IconDisplay name={task.icon} size={20} />
            </span>
          )}
          <div className="flex-1 min-w-0">
            {loading && <Skeleton variant="text" className="h-6 w-2/3" />}
            {task && !editingTitle && (
              <Text
                variant="h5"
                weight="semibold"
                className={`truncate duration-fast ${canEditTasks ? "cursor-pointer hover:text-accent" : ""}`}
                onClick={canEditTasks ? () => setEditingTitle(true) : undefined}
                title={task.title}
              >
                {task.title}
              </Text>
            )}
            {task && editingTitle && canEditTasks && (
              <Input
                autoFocus
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onFocus={() => dirtyFields.current.add("title")}
                onBlur={() => {
                  void handleTitleSave();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleTitleSave();
                }}
                className="text-h5 font-semibold bg-transparent px-r6 py-r6 rounded"
              />
            )}
          </div>
          <IconButton aria-label="Close panel" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="px-r3 py-r4">
              <Stack gap="r5">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="flex items-center min-h-[32px]">
                    <Skeleton variant="text" className="h-3 w-[100px] shrink-0 mr-r4" />
                    <Skeleton variant="rectangular" className="h-7 flex-1 rounded" />
                  </div>
                ))}
              </Stack>
            </div>
          )}

          {error && (
            <div className="px-r3 py-r4">
              <Text color="muted" variant="body-2">
                Error loading task: {error}
              </Text>
            </div>
          )}

          {task && (
            <>
              {/* Mark complete / incomplete button */}
              <div className="px-r3 pt-r4 pb-r5">
                <Button
                  variant={task.completed ? "ghost" : "primary"}
                  size="sm"
                  className={cn(
                    "w-full",
                    task.completed &&
                      "bg-status-success-subtle text-status-success border border-status-success/30 hover:bg-status-success-subtle/80"
                  )}
                  disabled={!canEditTasks}
                  onClick={() => {
                    void handleToggleComplete();
                  }}
                >
                  {task.completed ? (
                    <>
                      <CheckCircle2 size={14} className="mr-1" />
                      Completed
                    </>
                  ) : (
                    "Mark complete"
                  )}
                </Button>
              </div>

              {/* Properties */}
              <div className="px-r3 py-r4">
                <Stack gap="r6">
                  <PropertyRow label="Group">
                    {canEditTasks ? (
                      <GroupPicker
                        value={task.taskGroupId}
                        taskGroups={taskGroups}
                        onSelect={(newGroupId) => {
                          if (newGroupId === task.taskGroupId) return;
                          const oldGroupId = task.taskGroupId;
                          setLocalTask((prev) =>
                            prev ? { ...prev, taskGroupId: newGroupId } : prev
                          );
                          updateTaskInContext(taskId, { taskGroupId: newGroupId });
                          void (async () => {
                            try {
                              const res = await api.patch<{ task: Task }>(
                                `/api/tasks/${taskId}/move`,
                                {
                                  taskGroupId: newGroupId,
                                  position: task.position,
                                }
                              );
                              setLocalTask((prev) => (prev ? { ...prev, ...res.task } : prev));
                              updateTaskInContext(taskId, res.task);
                            } catch {
                              setLocalTask((prev) =>
                                prev ? { ...prev, taskGroupId: oldGroupId } : prev
                              );
                              updateTaskInContext(taskId, { taskGroupId: oldGroupId });
                              toast("Failed to move task", { variant: "error" });
                            }
                          })();
                        }}
                      />
                    ) : (
                      <GroupPickerReadOnly value={task.taskGroupId} taskGroups={taskGroups} />
                    )}
                  </PropertyRow>

                  <PropertyRow label="Priority">
                    {canEditTasks ? (
                      <PriorityPicker
                        value={task.priority}
                        onSelect={(priority) => {
                          void handlePatch({ priority });
                        }}
                      />
                    ) : (
                      <PriorityPickerReadOnly value={task.priority} />
                    )}
                  </PropertyRow>

                  <PropertyRow label="Assigned to">
                    {canEditTasks ? (
                      <AssigneePicker
                        value={task.assigneeId ?? null}
                        members={members}
                        onSelect={(userId) => {
                          void handlePatch({ assigneeId: userId });
                        }}
                      />
                    ) : (
                      <AssigneePickerReadOnly value={task.assigneeId ?? null} members={members} />
                    )}
                  </PropertyRow>

                  <PropertyRow label="Due date">
                    <Input
                      type="date"
                      value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
                      disabled={!canEditTasks}
                      onChange={(e) => {
                        void handlePatch({ dueDate: e.target.value || null });
                      }}
                      className="border-transparent bg-transparent hover:bg-surface-2 focus:bg-surface-0 py-1.5 px-r5 text-body-3 rounded"
                    />
                  </PropertyRow>

                  <PropertyRow label="Repeat">
                    {canEditTasks ? (
                      <RecurrencePicker
                        value={localTask.recurrenceRule ?? null}
                        onSelect={(rule) => {
                          void handlePatch({ recurrenceRule: rule });
                        }}
                      />
                    ) : (
                      <RecurrencePickerReadOnly value={localTask.recurrenceRule ?? null} />
                    )}
                  </PropertyRow>

                  <PropertyRow label="Cost">
                    <div className="relative">
                      <span className="absolute left-r5 top-1/2 -translate-y-1/2 text-body-3 text-fg-muted pointer-events-none">
                        $
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={costDisplay}
                        disabled={!canEditTasks}
                        onChange={(e) => setCostDisplay(e.target.value)}
                        onFocus={() => dirtyFields.current.add("cost")}
                        onBlur={() => {
                          void handleCostBlur();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="border-transparent bg-transparent hover:bg-surface-2 focus:bg-surface-0 py-1.5 pl-6 pr-r5 text-body-3 rounded"
                      />
                    </div>
                  </PropertyRow>

                  <PropertyRow label="Labels">
                    <TaskLabelPicker
                      taskId={task.id}
                      projectId={project.id}
                      labels={task.labels ?? []}
                      readOnly={!canEditTasks}
                    />
                  </PropertyRow>
                </Stack>
              </div>

              <Divider />

              {/* Description */}
              <div className="px-r3 py-r4">
                <Text variant="body-3" weight="semibold" color="secondary" className="mb-r5">
                  Description
                </Text>
                <Textarea
                  value={descriptionValue}
                  onChange={(e) => setDescriptionValue(e.target.value)}
                  onFocus={() => dirtyFields.current.add("description")}
                  onBlur={() => {
                    void handleDescriptionBlur();
                  }}
                  placeholder={canEditTasks ? "Add a description..." : "No description"}
                  readOnly={!canEditTasks}
                  className="resize-y min-h-[80px] border-transparent bg-surface-1 hover:border-border-default focus:border-border-strong focus:bg-surface-0"
                />
              </div>

              <Divider />

              {/* Subtasks */}
              <div className="px-r3 py-r4">
                <Text variant="body-3" weight="semibold" color="secondary" className="mb-r5">
                  Subtasks ({task.subtasks.length})
                </Text>

                <Stack gap="r6">
                  <DndContext
                    sensors={subtaskSensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleSubtaskDragStart}
                    onDragEnd={(event) => {
                      void handleSubtaskDragEnd(event);
                    }}
                  >
                    <SortableContext items={subtaskIds} strategy={verticalListSortingStrategy}>
                      {sortedSubtasks.map((subtask) => (
                        <SortableSubtaskRow
                          key={subtask.id}
                          subtask={subtask}
                          onToggle={(subtask) => {
                            void handleSubtaskToggle(subtask);
                          }}
                          onDelete={(id) => {
                            void handleDeleteSubtask(id);
                          }}
                          onRename={(id, title) => {
                            void handleRenameSubtask(id, title);
                          }}
                          readOnly={!canEditTasks}
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

                  {canEditTasks && (
                    <Input
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleAddSubtask();
                      }}
                      placeholder="+ Add subtask"
                      className="border-dashed border-border-default bg-transparent py-1.5 px-r5 text-body-3 rounded"
                    />
                  )}
                </Stack>
              </div>

              <Divider />

              {/* Attachments */}
              <TaskAttachmentSection
                taskId={task.id}
                projectId={project.id}
                readOnly={!canEditTasks}
              />

              <Divider />

              {/* Comments */}
              <div className="px-r3 py-r4">
                <Text variant="body-3" weight="semibold" color="secondary" className="mb-r5">
                  Comments ({task.commentCount})
                </Text>
                {isCommentsError && (
                  <Text variant="body-2" color="secondary" className="mb-r4">
                    Failed to load comments.
                  </Text>
                )}

                <Stack gap="r4">
                  {isCommentsLoading && <CommentSkeletonList />}
                  {paginatedComments.map((comment) => {
                    const author = members.find((m) => m.userId === comment.authorId);
                    const isOwn = currentUserId === comment.authorId;
                    const isEditing = editingCommentId === comment.id;
                    const isOptimistic = comment.id.startsWith("optimistic-");
                    return (
                      <div
                        key={comment.id}
                        className={`group rounded-md border border-border-default p-r4${isOptimistic ? " opacity-70" : ""}`}
                      >
                        <Row gap="r5" align="center" className="mb-r6">
                          <Avatar size="xs" name={comment.authorName} src={author?.user.image} />
                          <Text variant="body-3" weight="semibold">
                            {comment.authorName}
                          </Text>
                          <Text variant="body-3" color="muted" className="ml-auto">
                            {new Date(comment.createdAt).toLocaleDateString()}
                            {comment.updatedAt &&
                              new Date(comment.updatedAt).getTime() !==
                                new Date(comment.createdAt).getTime() && (
                                <span
                                  className="ml-1 italic"
                                  title={`Edited ${new Date(comment.updatedAt).toLocaleDateString()}`}
                                >
                                  (edited)
                                </span>
                              )}
                          </Text>
                          {isOwn && !isEditing && !isOptimistic && (
                            <Row
                              gap="r6"
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <IconButton
                                aria-label="Edit comment"
                                className="p-1"
                                onClick={() => {
                                  setEditingCommentId(comment.id);
                                  setEditingCommentBody(comment.body);
                                }}
                              >
                                <Pencil size={14} />
                              </IconButton>
                              <HoldToDeleteButton
                                onDelete={() => void handleDeleteComment(comment.id)}
                                label={`Hold to delete comment`}
                              />
                            </Row>
                          )}
                        </Row>
                        {isEditing ? (
                          <Stack gap="r6">
                            <Textarea
                              value={editingCommentBody}
                              onChange={(e) => setEditingCommentBody(e.target.value)}
                              className="min-h-[40px] border-border-default bg-surface-1 focus:bg-surface-0 text-body-2"
                              autoFocus
                            />
                            <Row gap="r6" className="justify-end">
                              <IconButton
                                aria-label="Cancel editing"
                                className="p-1"
                                onClick={() => setEditingCommentId(null)}
                              >
                                <X size={14} />
                              </IconButton>
                              <IconButton
                                aria-label="Save comment"
                                className="p-1 text-status-success"
                                onClick={() => void handleUpdateComment(comment.id)}
                              >
                                <Check size={14} />
                              </IconButton>
                            </Row>
                          </Stack>
                        ) : (
                          <Text variant="body-2">
                            <MentionText>{comment.body}</MentionText>
                          </Text>
                        )}
                      </div>
                    );
                  })}

                  {hasMoreComments && (
                    <div className="flex justify-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void fetchNextComments()}
                        disabled={isFetchingMoreComments}
                      >
                        {isFetchingMoreComments ? "Loading..." : "Load more comments"}
                      </Button>
                    </div>
                  )}

                  {canEditTasks && (
                    <>
                      <MentionTextarea
                        value={commentBody}
                        onChange={setCommentBody}
                        members={members}
                        placeholder="Write a comment... Use @ to mention"
                        className="min-h-[60px] border-border-default bg-surface-1 focus:bg-surface-0"
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          onClick={() => {
                            void handleAddComment();
                          }}
                          disabled={!commentBody.trim() || createComment.isPending}
                        >
                          {createComment.isPending ? "Sending..." : "Comment"}
                        </Button>
                      </div>
                    </>
                  )}
                </Stack>
              </div>

              <Divider />

              {/* Activity */}
              <div className="px-r3 py-r4">
                <TaskActivityFeed taskId={taskId} members={members} />
              </div>

              <Divider />

              {canEditTasks && (
                <div className={cn("px-r3 py-r4 flex items-center gap-r6", isMobile && "gap-r8")}>
                  <button
                    type="button"
                    onClick={() => void handleDuplicateTask()}
                    className={cn(
                      "flex items-center gap-r6 text-body-3 text-primary hover:underline cursor-pointer duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 rounded",
                      isMobile && "text-body-2 py-r4 px-r6 gap-r8"
                    )}
                  >
                    <Copy size={isMobile ? 18 : 14} />
                    Duplicate task
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteDialog(true)}
                    className={cn(
                      "flex items-center gap-r6 text-body-3 text-status-error hover:underline cursor-pointer duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 rounded",
                      isMobile && "text-body-2 py-r4 px-r6 gap-r8"
                    )}
                  >
                    <Trash2 size={isMobile ? 18 : 14} />
                    Delete task
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => void handleDeleteTask()}
        title="Delete Task"
        confirming={deleteTaskMutation.isPending}
      >
        Are you sure? This cannot be undone.
      </ConfirmDialog>
    </>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Copy,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Input } from "@/web/components/form/Input";
import { Textarea } from "@/web/components/form/Textarea";
import { Divider, Stack } from "@/web/components/layout";
import { useAppShell } from "@/web/components/ui/AppShell";
import { Button } from "@/web/components/ui/Button";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { CoverImage } from "@/web/components/ui/CoverImage";
import { IconButton } from "@/web/components/ui/IconButton";
import { IconDisplay } from "@/web/components/ui/IconDisplay";
import { IconGrid } from "@/web/components/ui/IconPicker";
import { Popover } from "@/web/components/ui/Popover";
import { Skeleton } from "@/web/components/ui/Skeleton";
import { Text } from "@/web/components/ui/Text";
import type { ToastAction } from "@/web/components/ui/Toast";
import type { Subtask, Task } from "@/web/contexts/ProjectContext";
import { useProject } from "@/web/contexts/ProjectContext";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useProjectPermissions } from "@/web/hooks/use-permissions";
import { useTaskCommentActions } from "@/web/hooks/use-task-comment-actions";
import { useTaskComments } from "@/web/hooks/use-task-comments";
import { useTaskCover } from "@/web/hooks/use-task-cover";
import { useTaskDetailActions } from "@/web/hooks/use-task-detail-actions";
import { useTaskEditing } from "@/web/hooks/use-task-editing";
import { useTaskSubtasks } from "@/web/hooks/use-task-subtasks";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { queryKeys } from "@/web/lib/query-keys";
import { TaskCommentSection } from "@/web/pages/TaskDetail/components/TaskCommentSection";
import { TaskActivityFeed } from "@/web/pages/TaskDetail/TaskActivityFeed";
import { TaskAttachmentSection } from "@/web/pages/TaskDetail/TaskAttachmentSection";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";
import { cn } from "@/web/util/style/style";

import { TaskDetailProperties } from "./TaskDetailProperties";
import { TaskSubtaskList } from "./TaskSubtaskList";

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
  const createSubtask = useMutation({
    mutationFn: (input: { title: string }) =>
      api.post<{ subtask: Subtask }>(`/api/tasks/${taskId}/subtasks`, input),
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
    coverUrl,
    coverSrcSet,
    coverAttribution,
    coverUploading,
    handleCoverUpload,
    handleCoverApplyUnsplash,
    handleCoverRemove,
    handleCoverPositionChange,
  } = useTaskCover({
    taskId,
    coverImageKey: task?.coverImageKey ?? null,
    coverUnsplash: task?.coverUnsplash ?? null,
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

  // Comment CRUD (shared with TaskDetailDialog)
  const {
    commentBody,
    setCommentBody,
    editingCommentId,
    setEditingCommentId,
    editingCommentBody,
    setEditingCommentBody,
    handleAddComment,
    handleUpdateComment,
    handleDeleteComment,
    resetCommentState,
    isAddingComment,
  } = useTaskCommentActions({
    taskId,
    currentUserId,
    currentUserName: session?.user?.name,
    invalidateTaskQueries,
    toast,
    updateTaskInContext,
    commentCount: localTask?.commentCount,
  });

  const [, setSearchParams] = useSearchParams();

  // Task-level actions (complete, duplicate, delete)
  const {
    showDeleteDialog,
    setShowDeleteDialog,
    handleToggleComplete,
    handleDuplicateTask,
    handleDeleteTask,
    isDeleting,
  } = useTaskDetailActions({
    taskId,
    localTask,
    setLocalTask,
    toast,
    workspaceId: workspace.id,
    projectId: project.id,
    onDeleteSuccess: () => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("task");
        return next;
      });
    },
    updateTaskInContext,
    addTaskToContext,
    removeTaskFromContext,
    refetchTasks,
  });

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
      resetCommentState();
      setShowDeleteDialog(false);
    });
  }, [taskId, qc, dirtyFields, setEditingTitle, setTitleValue, setDescriptionValue, setCostDisplay, setNewSubtaskTitle, resetCommentState, setShowDeleteDialog]);

  // Keyboard escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
            coverUrl={coverUrl}
            coverSrcSet={coverSrcSet}
            coverAttribution={coverAttribution}
            onUpload={(file: File) => {
              void handleCoverUpload(file);
            }}
            onApplyUnsplash={(payload) => {
              void handleCoverApplyUnsplash(payload);
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
                  <div key={i} className="flex items-center min-h-[2rem]">
                    <Skeleton variant="text" className="h-3 w-[6.25rem] shrink-0 mr-r4" />
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
                <TaskDetailProperties
                  task={task}
                  taskGroups={taskGroups}
                  members={members}
                  canEditTasks={canEditTasks}
                  costDisplay={costDisplay}
                  setCostDisplay={setCostDisplay}
                  onCostFocus={() => dirtyFields.current.add("cost")}
                  onCostBlur={() => {
                    void handleCostBlur();
                  }}
                  onPatch={(updates) => {
                    void handlePatch(updates);
                  }}
                  onGroupChange={(newGroupId) => {
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
                  projectId={project.id}
                />
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
                  rows={5}
                  className="resize-y min-h-[5rem] border-transparent bg-surface-1 hover:border-border-default focus:border-border-strong focus:bg-surface-0"
                />
              </div>

              <Divider />

              {/* Subtasks */}
              <div className="px-r3 py-r4">
                <Text variant="body-3" weight="semibold" color="secondary" className="mb-r5">
                  Subtasks ({task.subtasks.length})
                </Text>

                <TaskSubtaskList
                  subtaskSensors={subtaskSensors}
                  sortedSubtasks={sortedSubtasks}
                  subtaskIds={subtaskIds}
                  activeSubtask={activeSubtask}
                  newSubtaskTitle={newSubtaskTitle}
                  setNewSubtaskTitle={setNewSubtaskTitle}
                  onToggle={(s) => { void handleSubtaskToggle(s); }}
                  onDelete={(id) => { void handleDeleteSubtask(id); }}
                  onRename={(id, title) => { void handleRenameSubtask(id, title); }}
                  onAddSubtask={() => { void handleAddSubtask(); }}
                  onDragStart={handleSubtaskDragStart}
                  onDragEnd={(event) => { void handleSubtaskDragEnd(event); }}
                  canEdit={canEditTasks}
                />
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
                <TaskCommentSection
                  comments={paginatedComments}
                  members={members}
                  currentUserId={currentUserId}
                  commentCount={task.commentCount}
                  editingCommentId={editingCommentId}
                  editingCommentBody={editingCommentBody}
                  commentBody={commentBody}
                  onEditStart={(id, body) => {
                    setEditingCommentId(id);
                    setEditingCommentBody(body);
                  }}
                  onEditCancel={() => setEditingCommentId(null)}
                  onEditSave={handleUpdateComment}
                  onEditBodyChange={setEditingCommentBody}
                  onDelete={handleDeleteComment}
                  onCommentBodyChange={setCommentBody}
                  onAddComment={handleAddComment}
                  isLoading={isCommentsLoading}
                  isError={isCommentsError}
                  hasMore={hasMoreComments ?? false}
                  isFetchingMore={isFetchingMoreComments}
                  onLoadMore={() => void fetchNextComments()}
                  isAddingComment={isAddingComment}
                  canEdit={canEditTasks}
                  deleteVariant="hold"
                />
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
        confirming={isDeleting}
      >
        Are you sure? This cannot be undone.
      </ConfirmDialog>
    </>
  );
}

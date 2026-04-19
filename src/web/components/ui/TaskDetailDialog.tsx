import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, SmilePlus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Input } from "@/web/components/form/Input";
import { Textarea } from "@/web/components/form/Textarea";
import { Divider, Stack } from "@/web/components/layout";
import { useAppShell } from "@/web/components/ui/AppShell";
import { Button } from "@/web/components/ui/Button";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { CoverImage } from "@/web/components/ui/CoverImage";
import { Dialog } from "@/web/components/ui/Dialog";
import { IconButton } from "@/web/components/ui/IconButton";
import { IconDisplay } from "@/web/components/ui/IconDisplay";
import { IconGrid } from "@/web/components/ui/IconPicker";
import { Popover } from "@/web/components/ui/Popover";
import { Skeleton } from "@/web/components/ui/Skeleton";
import { Text } from "@/web/components/ui/Text";
import { useToast } from "@/web/components/ui/ToastContext";
import type { Subtask, Task, TaskGroup } from "@/web/contexts/ProjectContext";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { usePatchTaskMutation } from "@/web/hooks/use-patch-task-mutation";
import { useProjectPermissions } from "@/web/hooks/use-permissions";
import { useTaskCommentActions } from "@/web/hooks/use-task-comment-actions";
import { useTaskComments } from "@/web/hooks/use-task-comments";
import { useTaskCover } from "@/web/hooks/use-task-cover";
import { useTaskDetailActions } from "@/web/hooks/use-task-detail-actions";
import { useTaskEditing } from "@/web/hooks/use-task-editing";
import { useTaskSubtasks } from "@/web/hooks/use-task-subtasks";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { freshnessTracker } from "@/web/lib/freshness-tracker";
import { queryKeys } from "@/web/lib/query-keys";
import { TaskCommentSection } from "@/web/pages/TaskDetail/components/TaskCommentSection";
import { TaskDetailProperties } from "@/web/pages/TaskDetail/components/TaskDetailProperties";
import { TaskSubtaskList } from "@/web/pages/TaskDetail/components/TaskSubtaskList";
import { TaskActivityFeed } from "@/web/pages/TaskDetail/TaskActivityFeed";
import { TaskAttachmentSection } from "@/web/pages/TaskDetail/TaskAttachmentSection";
import type { TaskDetail } from "@/web/pages/TaskDetail/types";
import { cn } from "@/web/util/style/style";

interface TaskGroupResponse {
  taskGroups: TaskGroup[];
}

interface ProjectMember {
  userId: string;
  role: string;
}

interface ProjectMembersResponse {
  members: ProjectMember[];
}

export function TaskDetailDialog({
  taskId,
  members,
  open,
  onClose,
}: {
  taskId: string;
  members: WorkspaceMember[];
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { isMobile } = useAppShell();
  const qc = useQueryClient();
  const { workspace } = useWorkspace();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  // Fetch task detail
  const {
    data: taskData,
    isLoading: loading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.tasks.detail(taskId),
    queryFn: () => api.get<{ task: TaskDetail }>(`/api/tasks/${taskId}`),
    enabled: open && !!taskId,
  });

  const taskFromServer = taskData?.task ?? null;
  const projectId = taskFromServer?.projectId;

  const invalidateTaskQueries = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
    void qc.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId) });
    if (projectId) {
      void qc.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.projects.dashboard(projectId) });
    }
    void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspace.id) });
    freshnessTracker.recordMutation("tasks");
  }, [qc, taskId, projectId, workspace.id]);

  // Local optimistic copy of the task
  const [localTask, setLocalTask] = useState<TaskDetail | null>(null);
  const task = localTask;

  // Seed local task from API data
  useEffect(() => {
    if (taskFromServer) {
      queueMicrotask(() => {
        setLocalTask((prev) => {
          if (!prev || prev.id !== taskFromServer.id) return taskFromServer;
          return { ...prev, subtasks: taskFromServer.subtasks, labels: taskFromServer.labels };
        });
      });
    }
  }, [taskFromServer]);

  // Fetch task groups for the project
  const { data: taskGroupsData } = useQuery({
    queryKey: queryKeys.projects.taskGroups(projectId ?? ""),
    queryFn: () => api.get<TaskGroupResponse>(`/api/projects/${projectId}/task-groups`),
    enabled: !!projectId,
  });
  const taskGroups = taskGroupsData?.taskGroups ?? [];

  // Fetch project members for permission checks
  const { data: projectMembersData } = useQuery({
    queryKey: queryKeys.projects.members(projectId ?? ""),
    queryFn: () => api.get<ProjectMembersResponse>(`/api/projects/${projectId}/members`),
    enabled: !!projectId,
  });
  const projectMembers = projectMembersData?.members ?? [];

  // Fetch paginated comments
  const {
    comments: paginatedComments,
    isLoading: isCommentsLoading,
    isError: isCommentsError,
    fetchNextPage: fetchNextComments,
    hasNextPage: hasMoreComments,
    isFetchingNextPage: isFetchingMoreComments,
  } = useTaskComments(taskId, { enabled: open && !!taskId });

  // Permissions
  const { canEditTasks } = useProjectPermissions(projectMembers);

  // Noop context updater — the Dialog is not inside ProjectContext so there
  // is no board-level task list to synchronise. Data persists via query invalidation.
  const noopUpdateContext: (id: string, u: Partial<Task>) => void = useCallback(() => {}, []);

  // Comment CRUD (shared with TaskDetailPanelInner)
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
  });

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
    projectId,
    onDeleteSuccess: onClose,
  });

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      queueMicrotask(() => {
        setLocalTask(null);
        resetCommentState();
        setShowDeleteDialog(false);
      });
    }
  }, [open, resetCommentState, setShowDeleteDialog]);

  // Mutations (non-comment/non-task-action — those live in extracted hooks)
  const patchTask = usePatchTaskMutation({ taskId, workspaceId: workspace.id, projectId });

  const createSubtask = useMutation({
    mutationFn: (input: { title: string }) =>
      api.post<{ subtask: Subtask }>(`/api/tasks/${taskId}/subtasks`, input),
    onSettled: invalidateTaskQueries,
  });

  // --- Extracted hooks (shared with TaskDetailPanelInner) ---

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
    updateTaskInContext: noopUpdateContext,
    patchTaskMutateAsync: patchTask.mutateAsync,
    toast,
    refetch,
    taskData,
  });

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
    updateTaskInContext: noopUpdateContext,
    invalidateTaskQueries,
    toast,
    createSubtask,
  });

  const {
    coverUploading,
    handleCoverUpload,
    handleCoverRemove,
    handleCoverPositionChange,
  } = useTaskCover({
    taskId,
    setLocalTask,
    updateTaskInContext: noopUpdateContext,
    invalidateTaskQueries,
    patchTaskMutateAsync: patchTask.mutateAsync,
    toast,
    refetch,
  });

  async function handleMoveTask(newGroupId: string) {
    if (!task || newGroupId === task.taskGroupId) return;
    const oldGroupId = task.taskGroupId;
    setLocalTask((prev) => (prev ? { ...prev, taskGroupId: newGroupId } : prev));
    try {
      await api.patch(`/api/tasks/${taskId}/move`, {
        taskGroupId: newGroupId,
        position: task.position,
      });
      invalidateTaskQueries();
    } catch {
      setLocalTask((prev) => (prev ? { ...prev, taskGroupId: oldGroupId } : prev));
      toast("Failed to move task", { variant: "error" });
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-[40rem] p-0 overflow-hidden">
        <div className="max-h-[80vh] overflow-y-auto">
          {loading && (
            <Stack gap="r5" className="p-r3">
              <Skeleton variant="text" className="h-6 w-2/3" />
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center min-h-[2rem]">
                  <Skeleton variant="text" className="h-3 w-[6.25rem] shrink-0 mr-r4" />
                  <Skeleton variant="rectangular" className="h-7 flex-1 rounded" />
                </div>
              ))}
            </Stack>
          )}

          {queryError && (
            <div className="p-r3">
              <Text color="muted" variant="body-2">
                Error loading task: {queryError.message}
              </Text>
            </div>
          )}

          {task && (
            <Stack gap="r4">
              {/* Cover Image */}
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
                onPositionChange={(pos) => {
                  void handleCoverPositionChange(pos);
                }}
              />

              <Stack gap="r4" className="p-r3">
                {/* Header — icon + title */}
                <div className="flex items-start justify-between gap-r5">
                  <div className="flex items-center gap-r5 flex-1 min-w-0">
                    {/* Icon picker */}
                    {canEditTasks && (
                      <Popover placement="bottom-start" portal={false}>
                        <Popover.Trigger asChild>
                          <button
                            type="button"
                            className="shrink-0 inline-flex items-center justify-center size-8 rounded hover:bg-surface-2 active:bg-surface-3 duration-fast cursor-pointer text-fg-secondary"
                            aria-label={task.icon ? `Task icon: ${task.icon}` : "Add icon"}
                          >
                            {task.icon ? (
                              <IconDisplay name={task.icon} size={20} />
                            ) : (
                              <SmilePlus size={20} />
                            )}
                          </button>
                        </Popover.Trigger>
                        <Popover.Content className="w-72 p-r5">
                          <IconGrid
                            value={task.icon ?? null}
                            onChange={(icon) => {
                              void handlePatch({ icon });
                            }}
                            tooltipPortal={false}
                          />
                        </Popover.Content>
                      </Popover>
                    )}
                    {!canEditTasks && task.icon && (
                      <span className="shrink-0 inline-flex items-center justify-center size-8 text-fg-secondary">
                        <IconDisplay name={task.icon} size={20} />
                      </span>
                    )}

                    <div className="flex-1 min-w-0">
                      {editingTitle && canEditTasks ? (
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
                            if (e.key === "Escape") {
                              dirtyFields.current.delete("title");
                              setTitleValue(task?.title ?? "");
                              setEditingTitle(false);
                            }
                          }}
                          className="text-h5 font-semibold bg-transparent"
                        />
                      ) : (
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
                    </div>
                  </div>
                  <IconButton aria-label="Close dialog" onClick={onClose}>
                    <X size={18} />
                  </IconButton>
                </div>

                {/* Mark complete button */}
                <Button
                  variant={task.completed ? "ghost" : "primary"}
                  size="sm"
                  className="w-full"
                  disabled={!canEditTasks}
                  onClick={() => {
                    void handleToggleComplete();
                  }}
                >
                  {task.completed ? "Mark incomplete" : "Mark complete"}
                </Button>

                {/* Properties */}
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
                    void handleMoveTask(newGroupId);
                  }}
                  projectId={projectId}
                />

                <Divider />

                {/* Description */}
                <div>
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
                <div>
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
                  projectId={projectId!}
                  readOnly={!canEditTasks}
                />

                <Divider />

                {/* Comments */}
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
                  deleteVariant="icon"
                />

                <Divider />

                {/* Activity Feed */}
                <div>
                  <TaskActivityFeed taskId={taskId} members={members} />
                </div>

                <Divider />

                {/* Duplicate / Delete task */}
                {canEditTasks && (
                  <div className={cn("flex items-center gap-r6", isMobile && "gap-r8")}>
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
              </Stack>
            </Stack>
          )}
        </div>
      </Dialog>

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

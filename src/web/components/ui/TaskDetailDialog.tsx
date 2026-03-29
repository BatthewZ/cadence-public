import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, GripVertical, Pencil, SmilePlus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { generateKeyBetween } from "@/shared/lib/fractional-index";
import { TASK_PRIORITIES, type TaskPriority } from "@/shared/types/roles";
import { Input } from "@/web/components/form/Input";
import { MentionTextarea } from "@/web/components/form/MentionTextarea";
import { Select } from "@/web/components/form/Select";
import { TaskCheckbox } from "@/web/components/form/TaskCheckbox";
import { Textarea } from "@/web/components/form/Textarea";
import { Divider, Row, Stack } from "@/web/components/layout";
import { TaskLabelPicker } from "@/web/components/project/TaskLabelPicker";
import { useAppShell } from "@/web/components/ui/AppShell";
import { Avatar } from "@/web/components/ui/Avatar";
import { Button } from "@/web/components/ui/Button";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { CoverImage } from "@/web/components/ui/CoverImage";
import { Dialog } from "@/web/components/ui/Dialog";
import { IconButton } from "@/web/components/ui/IconButton";
import { IconDisplay } from "@/web/components/ui/IconDisplay";
import { IconGrid } from "@/web/components/ui/IconPicker";
import { MentionText } from "@/web/components/ui/MentionText";
import { Popover } from "@/web/components/ui/Popover";
import { CommentSkeletonList, Skeleton } from "@/web/components/ui/Skeleton";
import { Text } from "@/web/components/ui/Text";
import { useToast } from "@/web/components/ui/ToastContext";
import type { Comment, Subtask, Task, TaskGroup } from "@/web/contexts/ProjectContext";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useDeferredDelete } from "@/web/hooks/use-deferred-delete";
import { useFileUpload } from "@/web/hooks/use-file-upload";
import { useProjectPermissions } from "@/web/hooks/use-permissions";
import {
  type CommentsPage,
  optimisticAddComment,
  optimisticUpdateComment,
  rollbackAddComment,
  rollbackUpdateComment,
  useTaskComments,
} from "@/web/hooks/use-task-comments";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { queryKeys } from "@/web/lib/query-keys";
import { PropertyRow } from "@/web/pages/TaskDetail/components/PropertyRow";
import { SortableSubtaskRow } from "@/web/pages/TaskDetail/components/SortableSubtaskRow";
import { TaskActivityFeed } from "@/web/pages/TaskDetail/TaskActivityFeed";
import { TaskAttachmentSection } from "@/web/pages/TaskDetail/TaskAttachmentSection";
import { cn } from "@/web/util/style/style";

interface TaskDetail extends Task {
  subtasks: Subtask[];
  commentCount: number;
  cost?: number | null;
  coverImagePosition?: number | null;
  projectId: string;
}

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
    }
  }, [qc, taskId, projectId]);

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

  // Cover image upload
  const { state: coverUploadState, upload: uploadFile } = useFileUpload<{
    coverImageKey: string;
  }>();
  const coverUploading = coverUploadState === "uploading";

  const handleCoverUpload = useCallback(
    async (file: File) => {
      const result = await uploadFile(file, {
        endpoint: `/api/tasks/${taskId}/cover`,
        method: "put",
        fieldName: "file",
      });
      if (result) {
        setLocalTask((prev) => (prev ? { ...prev, coverImageKey: result.coverImageKey } : prev));
        invalidateTaskQueries();
      }
    },
    [taskId, uploadFile, invalidateTaskQueries]
  );

  const handleCoverRemove = useCallback(async () => {
    let prevCoverKey: string | null = null;
    setLocalTask((prev) => {
      if (!prev) return prev;
      prevCoverKey = prev.coverImageKey ?? null;
      return { ...prev, coverImageKey: null };
    });
    try {
      await api.delete(`/api/tasks/${taskId}/cover`);
      invalidateTaskQueries();
    } catch {
      setLocalTask((prev) => (prev ? { ...prev, coverImageKey: prevCoverKey } : prev));
      toast("Failed to remove cover image", { variant: "error" });
    }
  }, [taskId, toast, invalidateTaskQueries]);

  // Local editable state
  const [titleValue, setTitleValue] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState("");
  const [costDisplay, setCostDisplay] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Track which fields the user is actively editing so server refetches
  // don't clobber in-progress input (ref to avoid re-renders).
  const dirtyFields = useRef<Set<string>>(new Set());

  // Sync from server data — skip fields the user is currently editing
  useEffect(() => {
    if (taskFromServer) {
      queueMicrotask(() => {
        if (!dirtyFields.current.has("title")) setTitleValue(taskFromServer.title);
        if (!dirtyFields.current.has("description"))
          setDescriptionValue(taskFromServer.description ?? "");
        if (!dirtyFields.current.has("cost"))
          setCostDisplay(taskFromServer.cost != null ? (taskFromServer.cost / 100).toFixed(2) : "");
      });
    }
  }, [taskFromServer]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      dirtyFields.current.clear();
      queueMicrotask(() => {
        setLocalTask(null);
        setEditingTitle(false);
        setCommentBody("");
        setNewSubtaskTitle("");
        setEditingCommentId(null);
        setEditingCommentBody("");
        setShowDeleteDialog(false);
        setCostDisplay("");
      });
    }
  }, [open]);

  // Subtask DnD
  const subtaskSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Deferred delete with undo for subtasks
  const subtaskDeletion = useDeferredDelete<Subtask>({
    onDelete: async (subtaskId) => {
      await api.delete(`/api/subtasks/${subtaskId}`);
      invalidateTaskQueries();
    },
    onError: () => {
      toast("Failed to delete subtask", { variant: "error" });
      void refetch();
    },
    onToast: (message, undoFn) => {
      toast(message, { variant: "success", action: { label: "Undo", onClick: undoFn } });
    },
  });

  // Deferred delete with undo for comments
  const commentDeletion = useDeferredDelete<Comment>({
    onDelete: async (id) => {
      await deleteCommentMutation.mutateAsync(id);
    },
    onError: () => {
      toast("Failed to delete comment", { variant: "error" });
      void refetch();
    },
    onToast: (message, undoFn) => {
      toast(message, { variant: "success", action: { label: "Undo", onClick: undoFn } });
    },
  });

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

  // Cover image position handler (needs patchTask declared above)
  const handleCoverPositionChange = useCallback(
    async (pos: number) => {
      setLocalTask((prev) => (prev ? { ...prev, coverImagePosition: pos } : prev));
      try {
        await patchTask.mutateAsync({ coverImagePosition: pos });
      } catch {
        toast("Failed to update cover position", { variant: "error" });
        void refetch();
      }
    },
    [patchTask, toast, refetch]
  );

  // Sorted subtasks
  const subtasks = task?.subtasks;
  const sortedSubtasks = useMemo(
    () =>
      subtasks
        ? [...subtasks].sort((a, b) =>
            a.position < b.position ? -1 : a.position > b.position ? 1 : 0
          )
        : [],
    [subtasks]
  );
  const subtaskIds = useMemo(() => sortedSubtasks.map((s) => s.id), [sortedSubtasks]);
  const [activeSubtaskId, setActiveSubtaskId] = useState<string | null>(null);
  const activeSubtask = activeSubtaskId
    ? (sortedSubtasks.find((s) => s.id === activeSubtaskId) ?? null)
    : null;

  // Handlers
  async function handlePatch(updates: Partial<TaskDetail>) {
    const rollback: Record<string, unknown> = {};
    setLocalTask((prev) => {
      if (!prev) return prev;
      for (const key of Object.keys(updates)) {
        rollback[key] = prev[key as keyof TaskDetail];
      }
      return { ...prev, ...updates };
    });
    try {
      await patchTask.mutateAsync(updates);
    } catch {
      setLocalTask((prev) => (prev ? { ...prev, ...rollback } : prev));
      toast("Failed to update task", { variant: "error" });
    }
  }

  async function handleTitleSave() {
    setEditingTitle(false);
    dirtyFields.current.delete("title");
    if (titleValue.trim() && titleValue !== task?.title) {
      await handlePatch({ title: titleValue.trim() });
    }
  }

  async function handleDescriptionBlur() {
    dirtyFields.current.delete("description");
    if (descriptionValue !== (task?.description ?? "")) {
      await handlePatch({ description: descriptionValue || null });
    }
  }

  async function handleCostBlur() {
    dirtyFields.current.delete("cost");
    const parsed = parseFloat(costDisplay);
    const newCostCents = costDisplay.trim() === "" ? null : Math.round(parsed * 100);
    const currentCost = task?.cost ?? null;

    if (newCostCents !== currentCost && !Number.isNaN(parsed)) {
      await handlePatch({ cost: newCostCents });
    } else if (costDisplay.trim() === "" && currentCost !== null) {
      await handlePatch({ cost: null });
    }
  }

  async function handleSubtaskToggle(subtask: Subtask) {
    setLocalTask((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        subtasks: prev.subtasks.map((s) =>
          s.id === subtask.id ? { ...s, completed: !s.completed } : s
        ),
      };
    });
    try {
      await api.patch(`/api/subtasks/${subtask.id}`, {
        completed: !subtask.completed,
      });
      invalidateTaskQueries();
    } catch {
      setLocalTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks.map((s) =>
            s.id === subtask.id ? { ...s, completed: subtask.completed } : s
          ),
        };
      });
      toast("Failed to update subtask", { variant: "error" });
    }
  }

  async function handleAddSubtask() {
    if (!newSubtaskTitle.trim()) return;
    const title = newSubtaskTitle.trim();
    setNewSubtaskTitle("");

    // Optimistically add subtask to local state
    const lastPosition =
      sortedSubtasks.length > 0 ? sortedSubtasks[sortedSubtasks.length - 1].position : null;
    const optimisticSubtask: Subtask = {
      id: `optimistic-${crypto.randomUUID()}`,
      title,
      completed: false,
      position: generateKeyBetween(lastPosition, null),
    };
    setLocalTask((prev) => {
      if (!prev) return prev;
      return { ...prev, subtasks: [...prev.subtasks, optimisticSubtask] };
    });

    try {
      const result = await createSubtask.mutateAsync({ title });
      // Replace optimistic subtask with server-returned subtask
      setLocalTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks.map((s) => (s.id === optimisticSubtask.id ? result.subtask : s)),
        };
      });
    } catch {
      // Remove optimistic subtask on failure
      setLocalTask((prev) => {
        if (!prev) return prev;
        return { ...prev, subtasks: prev.subtasks.filter((s) => s.id !== optimisticSubtask.id) };
      });
      toast("Failed to add subtask", { variant: "error" });
    }
  }

  function handleDeleteSubtask(subtaskId: string) {
    const removedSubtask = localTask?.subtasks.find((s) => s.id === subtaskId);
    if (!removedSubtask) return;

    setLocalTask((prev) => {
      if (!prev) return prev;
      return { ...prev, subtasks: prev.subtasks.filter((s) => s.id !== subtaskId) };
    });

    subtaskDeletion.schedule(subtaskId, removedSubtask, "Subtask deleted", (restored) => {
      setLocalTask((prev) => {
        if (!prev) return prev;
        return { ...prev, subtasks: [...prev.subtasks, restored] };
      });
    });
  }

  async function handleRenameSubtask(subtaskId: string, title: string) {
    const oldTitle = task?.subtasks.find((s) => s.id === subtaskId)?.title;
    setLocalTask((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        subtasks: prev.subtasks.map((s) => (s.id === subtaskId ? { ...s, title } : s)),
      };
    });
    try {
      await api.patch(`/api/subtasks/${subtaskId}`, { title });
      invalidateTaskQueries();
    } catch {
      setLocalTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks.map((s) =>
            s.id === subtaskId ? { ...s, title: oldTitle ?? title } : s
          ),
        };
      });
      toast("Failed to rename subtask", { variant: "error" });
    }
  }

  function handleSubtaskDragStart(event: DragStartEvent) {
    setActiveSubtaskId(event.active.id as string);
  }

  async function handleSubtaskDragEnd(event: DragEndEvent) {
    setActiveSubtaskId(null);
    const { active, over } = event;
    if (!over || active.id === over.id || !task) return;

    const oldIndex = sortedSubtasks.findIndex((s) => s.id === active.id);
    const newIndex = sortedSubtasks.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sortedSubtasks, oldIndex, newIndex);
    const above = newIndex > 0 ? reordered[newIndex - 1] : null;
    const below = newIndex < reordered.length - 1 ? reordered[newIndex + 1] : null;
    const newPosition = generateKeyBetween(above?.position ?? null, below?.position ?? null);

    const movedSubtask = sortedSubtasks[oldIndex];

    setLocalTask((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        subtasks: prev.subtasks.map((s) =>
          s.id === movedSubtask.id ? { ...s, position: newPosition } : s
        ),
      };
    });

    try {
      await api.patch(`/api/subtasks/${movedSubtask.id}`, { position: newPosition });
      invalidateTaskQueries();
    } catch {
      setLocalTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks.map((s) =>
            s.id === movedSubtask.id ? { ...s, position: movedSubtask.position } : s
          ),
        };
      });
      toast("Failed to reorder subtask", { variant: "error" });
    }
  }

  async function handleAddComment() {
    if (!commentBody.trim()) return;
    const body = commentBody.trim();
    setCommentBody("");

    const optimisticComment = optimisticAddComment(qc, taskId, {
      body,
      authorId: currentUserId ?? "",
      authorName: session?.user?.name ?? "",
    });

    try {
      await createComment.mutateAsync({ body });
    } catch {
      rollbackAddComment(qc, taskId, optimisticComment.id);
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

  function handleDeleteComment(commentId: string) {
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

    commentDeletion.schedule(commentId, removedComment, "Comment deleted", () => {
      invalidateTaskQueries();
    });
  }

  async function handleToggleComplete() {
    if (!task) return;
    const wasCompleted = task.completed;
    setLocalTask((prev) => (prev ? { ...prev, completed: !wasCompleted } : prev));
    const endpoint = wasCompleted
      ? `/api/tasks/${taskId}/uncomplete`
      : `/api/tasks/${taskId}/complete`;
    try {
      await api.post(endpoint, {});
      invalidateTaskQueries();
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspace.id) });
    } catch {
      setLocalTask((prev) => (prev ? { ...prev, completed: wasCompleted } : prev));
      toast("Failed to update task", { variant: "error" });
    }
  }

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

  async function handleDuplicateTask() {
    try {
      await api.post(`/api/tasks/${taskId}/duplicate`, {});
      invalidateTaskQueries();
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
      onClose();
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.dashboard(workspace.id) });
      toast("Task deleted", { variant: "success" });
    } catch {
      toast("Failed to delete task", { variant: "error" });
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-[640px]">
        <div className="max-h-[80vh] overflow-y-auto">
          {loading && (
            <Stack gap="r5" className="p-r3">
              <Skeleton variant="text" className="h-6 w-2/3" />
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center min-h-[32px]">
                  <Skeleton variant="text" className="h-3 w-[100px] shrink-0 mr-r4" />
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
                onPositionChange={(pos) => { void handleCoverPositionChange(pos); }}
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
                <Stack gap="r6">
                  <PropertyRow label="Group">
                    <Select
                      value={task.taskGroupId}
                      disabled={!canEditTasks}
                      onChange={(e) => {
                        void handleMoveTask(e.target.value);
                      }}
                      className="border-transparent bg-transparent hover:bg-surface-2 focus:bg-surface-0 py-1.5 pl-r5 text-body-3 rounded"
                    >
                      {taskGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                          {g.isCompletionGroup ? " \u2713" : ""}
                        </option>
                      ))}
                    </Select>
                  </PropertyRow>

                  <PropertyRow label="Priority">
                    <Select
                      value={task.priority}
                      disabled={!canEditTasks}
                      onChange={(e) => {
                        void handlePatch({ priority: e.target.value as TaskPriority });
                      }}
                      className="border-transparent bg-transparent hover:bg-surface-2 focus:bg-surface-0 py-1.5 pl-r5 text-body-3 rounded"
                    >
                      {TASK_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        </option>
                      ))}
                    </Select>
                  </PropertyRow>

                  <PropertyRow label="Assigned to">
                    <Select
                      value={task.assigneeId ?? ""}
                      disabled={!canEditTasks}
                      onChange={(e) => {
                        void handlePatch({ assigneeId: e.target.value || null });
                      }}
                      className="border-transparent bg-transparent hover:bg-surface-2 focus:bg-surface-0 py-1.5 pl-r5 text-body-3 rounded"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.user.name}
                        </option>
                      ))}
                    </Select>
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

                  {projectId && (
                    <PropertyRow label="Labels">
                      <TaskLabelPicker
                        taskId={task.id}
                        projectId={projectId}
                        labels={task.labels ?? []}
                        readOnly={!canEditTasks}
                      />
                    </PropertyRow>
                  )}
                </Stack>

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
                    className="resize-y min-h-[80px] border-transparent bg-surface-1 hover:border-border-default focus:border-border-strong focus:bg-surface-0"
                  />
                </div>

                <Divider />

                {/* Subtasks */}
                <div>
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
                            onToggle={(s) => {
                              void handleSubtaskToggle(s);
                            }}
                            onDelete={(id) => {
                              handleDeleteSubtask(id);
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
                  projectId={projectId!}
                  readOnly={!canEditTasks}
                />

                <Divider />

                {/* Comments */}
                <div>
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
                                <IconButton
                                  aria-label="Delete comment"
                                  className="p-1 text-status-error"
                                  onClick={() => handleDeleteComment(comment.id)}
                                >
                                  <Trash2 size={14} />
                                </IconButton>
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
                                  onClick={() => {
                                    void handleUpdateComment(comment.id);
                                  }}
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
        confirming={deleteTaskMutation.isPending}
      >
        Are you sure? This cannot be undone.
      </ConfirmDialog>
    </>
  );
}

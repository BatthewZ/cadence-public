import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Pencil, Trash2 as Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { generateKeyBetween } from "@/shared/lib/fractional-index";
import { Field, Input, Label, Select, Toggle } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateTitle,
  IconButton,
  Text,
} from "@/web/components/ui";
import type { useToast } from "@/web/components/ui/ToastContext";
import { type Task, type TaskGroup, useProject } from "@/web/contexts/ProjectContext";
import { apiErrorMessage } from "@/web/lib/api/client";
import { sendWrite } from "@/web/lib/offline/send-write";
import { queryKeys } from "@/web/lib/query-keys";
import { sortByPosition } from "@/web/lib/sort-by-position";
import { TASK_GROUP_COLORS } from "@/web/util/task-display";

import type { CreateTaskGroupInput, ReorderTaskGroupInput, UpdateTaskGroupInput } from "./types";

export function TaskGroupsTab({
  projectId,
  toast,
}: {
  projectId: string;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const {
    taskGroups: contextTaskGroups,
    refetchTaskGroups,
    refetchTasks,
    addTaskGroup,
    updateTaskGroup,
    removeTaskGroup,
  } = useProject();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [targetGroupId, setTargetGroupId] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<TaskGroup | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupColor, setGroupColor] = useState(TASK_GROUP_COLORS[0]);
  const [groupIsCompletion, setGroupIsCompletion] = useState(false);

  const qc = useQueryClient();
  const taskGroups = sortByPosition(contextTaskGroups);

  const {
    mutateAsync: createGroup,
    isPending: creating,
    error: createErrorObj,
  } = useMutation({
    networkMode: "always",
    mutationFn: (input: CreateTaskGroupInput & { id: string }) =>
      sendWrite<{ taskGroup: TaskGroup }>({
        method: "POST",
        path: `/api/projects/${projectId}/task-groups`,
        body: input,
        label: `Add task group “${input.name}”`,
      }),
    onMutate: (input) => {
      addTaskGroup({
        ...input,
        isCompletionGroup: false,
        position: generateKeyBetween(taskGroups.at(-1)?.position ?? null, null),
        taskCount: 0,
      });
    },
    onSuccess: (result) => {
      if (result.status !== "sent") return;
      updateTaskGroup(result.data.taskGroup.id, result.data.taskGroup);
      refetchTaskGroups();
    },
    onError: (_err, input) => removeTaskGroup(input.id),
  });
  const createError = createErrorObj?.message ?? null;

  const {
    mutateAsync: updateGroup,
    isPending: updating,
    error: updateErrorObj,
  } = useMutation({
    networkMode: "always",
    mutationFn: ({ group, ...input }: UpdateTaskGroupInput & { group: TaskGroup }) =>
      sendWrite({
        method: "PATCH",
        path: `/api/task-groups/${group.id}`,
        body: input,
        label: `Edit task group “${group.name}”`,
      }),
    onMutate: ({ group, ...input }) => updateTaskGroup(group.id, input),
    onSuccess: (result) => {
      if (result.status === "sent") refetchTaskGroups();
    },
    onError: (_err, { group }) =>
      updateTaskGroup(group.id, {
        name: group.name,
        color: group.color,
        isCompletionGroup: group.isCompletionGroup,
      }),
  });
  const updateError = updateErrorObj?.message ?? null;

  function openCreateDialog() {
    setGroupName("");
    setGroupColor(TASK_GROUP_COLORS[0]);
    setCreateDialogOpen(true);
  }

  function openEditDialog(group: TaskGroup) {
    setSelectedGroup(group);
    setGroupName(group.name);
    setGroupColor(group.color ?? TASK_GROUP_COLORS[0]);
    setGroupIsCompletion(group.isCompletionGroup);
    setEditDialogOpen(true);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;

    try {
      await createGroup({ id: crypto.randomUUID(), name: groupName.trim(), color: groupColor });
      toast("Task group created.", { variant: "success" });
      setCreateDialogOpen(false);
    } catch {
      // error is captured by the mutation state
    }
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    if (!groupName.trim() || !selectedGroup) return;

    try {
      await updateGroup({
        group: selectedGroup,
        name: groupName.trim(),
        color: groupColor,
        isCompletionGroup: groupIsCompletion,
      });
      toast("Task group updated.", { variant: "success" });
      setEditDialogOpen(false);
      setSelectedGroup(null);
    } catch {
      // error is captured by the mutation state
    }
  }

  function openDeleteDialog(groupId: string) {
    const otherGroups = taskGroups.filter((g) => g.id !== groupId);
    setDeleteGroupId(groupId);
    setTargetGroupId(otherGroups[0]?.id ?? "");
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    const group = taskGroups.find((g) => g.id === deleteGroupId);
    if (!group || !targetGroupId) return;
    const target = targetGroupId;
    const tasksKey = queryKeys.projects.tasks(projectId);
    const previousTasks = qc.getQueryData<{ tasks: Task[] }>(tasksKey);
    const movedCount = previousTasks?.tasks.filter((t) => t.taskGroupId === group.id).length ?? 0;
    const previousTargetCount = taskGroups.find((g) => g.id === target)?.taskCount;

    removeTaskGroup(group.id);
    if (previousTargetCount !== undefined) {
      updateTaskGroup(target, { taskCount: previousTargetCount + (group.taskCount ?? movedCount) });
    }
    qc.setQueryData<{ tasks: Task[] }>(tasksKey, (old) =>
      old
        ? {
            tasks: old.tasks.map((t) =>
              t.taskGroupId === group.id ? { ...t, taskGroupId: target } : t
            ),
          }
        : old
    );
    setDeleteDialogOpen(false);
    setDeleteGroupId(null);
    setTargetGroupId("");

    try {
      const result = await sendWrite({
        method: "DELETE",
        path: `/api/task-groups/${group.id}?targetGroupId=${encodeURIComponent(target)}`,
        label: `Delete task group “${group.name}”`,
      });
      toast("Task group deleted.", { variant: "success" });
      if (result.status === "sent") {
        refetchTaskGroups();
        refetchTasks();
      }
    } catch (err) {
      addTaskGroup(group);
      if (previousTargetCount !== undefined)
        updateTaskGroup(target, { taskCount: previousTargetCount });
      if (previousTasks) qc.setQueryData(tasksKey, previousTasks);
      toast(apiErrorMessage(err, "Failed to delete task group."), { variant: "error" });
    }
  }

  async function handleReorder(groupId: string, direction: "up" | "down") {
    const idx = taskGroups.findIndex((g) => g.id === groupId);
    if (idx === -1) return;

    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= taskGroups.length) return;

    // Compute a position key that places this group at the target index
    const before = targetIdx > 0 && direction === "up" ? taskGroups[targetIdx - 1].position : null;
    const after =
      targetIdx < taskGroups.length - 1 && direction === "down"
        ? taskGroups[targetIdx + 1].position
        : null;
    const neighbor = taskGroups[targetIdx].position;

    const newPosition =
      direction === "up"
        ? generateKeyBetween(before, neighbor)
        : generateKeyBetween(neighbor, after);

    const group = taskGroups[idx];
    updateTaskGroup(groupId, { position: newPosition });
    try {
      const result = await sendWrite({
        method: "PATCH",
        path: `/api/task-groups/${groupId}/reorder`,
        body: { position: newPosition } satisfies ReorderTaskGroupInput,
        label: `Reorder task group “${group.name}”`,
      });
      if (result.status === "sent") refetchTaskGroups();
    } catch (err) {
      updateTaskGroup(groupId, { position: group.position });
      toast(apiErrorMessage(err, "Failed to reorder task group."), { variant: "error" });
    }
  }

  return (
    <>
      <Row justify="between" align="center">
        <Text variant="body-2" color="secondary">
          {taskGroups.length} {taskGroups.length === 1 ? "group" : "groups"}
        </Text>
        <Button variant="primary" size="md" onClick={openCreateDialog}>
          + Add Group
        </Button>
      </Row>

      {taskGroups.length === 0 ? (
        <EmptyState size="md">
          <EmptyStateTitle>No task groups</EmptyStateTitle>
          <EmptyStateDescription>
            Create task groups to organize your project tasks into columns or categories.
          </EmptyStateDescription>
          <EmptyStateActions>
            <Button variant="primary" size="md" onClick={openCreateDialog}>
              Create First Group
            </Button>
          </EmptyStateActions>
        </EmptyState>
      ) : (
        <Stack gap="r5">
          {taskGroups.map((group, idx) => (
            <Card
              key={group.id}
              className="border border-border-default bg-surface-0 rounded-lg overflow-hidden"
            >
              <Row justify="between" align="center" className="px-r5 py-r6">
                <Row gap="r4" align="center">
                  {group.isCompletionGroup ? (
                    <span className="size-4 rounded-full shrink-0 bg-status-success flex items-center justify-center">
                      <Check size={10} className="text-fg-inverse" />
                    </span>
                  ) : (
                    <span
                      className="inline-block size-4 rounded-full shrink-0 border border-border-default"
                      style={{ backgroundColor: group.color }}
                    />
                  )}
                  <Text variant="body-2" weight="semibold">
                    {group.name}
                  </Text>
                  {group.isCompletionGroup && (
                    <Badge variant="success" className="text-[0.625rem] px-1.5 py-0">
                      Auto-complete
                    </Badge>
                  )}
                  <Text variant="body-3" color="muted">
                    {group.taskCount} {group.taskCount === 1 ? "task" : "tasks"}
                  </Text>
                </Row>
                <Row gap="r5" align="center">
                  <IconButton
                    aria-label="Move up"
                    disabled={idx === 0}
                    onClick={() => void handleReorder(group.id, "up")}
                  >
                    <ArrowUp size={16} />
                  </IconButton>
                  <IconButton
                    aria-label="Move down"
                    disabled={idx === taskGroups.length - 1}
                    onClick={() => void handleReorder(group.id, "down")}
                  >
                    <ArrowDown size={16} />
                  </IconButton>
                  <IconButton
                    aria-label={`Edit ${group.name}`}
                    onClick={() => openEditDialog(group)}
                  >
                    <Pencil size={16} />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete ${group.name}`}
                    className="hover:text-status-error"
                    onClick={() => openDeleteDialog(group.id)}
                    disabled={taskGroups.length < 2}
                  >
                    <Trash2Icon size={16} />
                  </IconButton>
                </Row>
              </Row>
            </Card>
          ))}
        </Stack>
      )}

      {/* Create Task Group Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)}>
        <form onSubmit={(e) => void handleCreate(e)}>
          <Stack gap="r4">
            <Text variant="h5">Create Task Group</Text>

            <Field>
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="To Do"
              />
            </Field>

            <Field>
              <Label>Color</Label>
              <Row gap="r5" wrap>
                {TASK_GROUP_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="size-8 rounded-full border-2 cursor-pointer"
                    style={{
                      backgroundColor: color,
                      borderColor: groupColor === color ? "var(--color-fg-primary)" : "transparent",
                    }}
                    onClick={() => setGroupColor(color)}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </Row>
            </Field>

            {createError && <Alert variant="error">{createError}</Alert>}

            <Row gap="r4" justify="end">
              <Button
                variant="ghost"
                size="md"
                type="button"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={creating}>
                {creating ? "Creating..." : "Create Group"}
              </Button>
            </Row>
          </Stack>
        </form>
      </Dialog>

      {/* Edit Task Group Dialog */}
      <Dialog
        open={editDialogOpen}
        onClose={() => {
          setEditDialogOpen(false);
          setSelectedGroup(null);
        }}
      >
        <form onSubmit={(e) => void handleEdit(e)}>
          <Stack gap="r4">
            <Text variant="h5">Edit Task Group</Text>

            <Field>
              <Label htmlFor="edit-group-name">Group Name</Label>
              <Input
                id="edit-group-name"
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </Field>

            <Field>
              <Label>Color</Label>
              <Row gap="r5" wrap>
                {TASK_GROUP_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="size-8 rounded-full border-2 cursor-pointer"
                    style={{
                      backgroundColor: color,
                      borderColor: groupColor === color ? "var(--color-fg-primary)" : "transparent",
                    }}
                    onClick={() => setGroupColor(color)}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </Row>
            </Field>

            <Field>
              <Row gap="r4" align="center" justify="between">
                <div>
                  <Label>Completion Group</Label>
                  <Text variant="body-3" color="muted">
                    Tasks moved into this group will automatically be marked as completed
                  </Text>
                </div>
                {/* tone="success" — green carries semantic weight here
                    ("this group marks tasks as completed"), unlike the
                    settings-page toggles which use the default accent. */}
                <Toggle
                  checked={groupIsCompletion}
                  onCheckedChange={setGroupIsCompletion}
                  tone="success"
                  aria-label="Completion Group"
                />
              </Row>
            </Field>

            {updateError && <Alert variant="error">{updateError}</Alert>}

            <Row gap="r4" justify="end">
              <Button
                variant="ghost"
                size="md"
                type="button"
                onClick={() => {
                  setEditDialogOpen(false);
                  setSelectedGroup(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={updating}>
                {updating ? "Saving..." : "Save Changes"}
              </Button>
            </Row>
          </Stack>
        </form>
      </Dialog>

      {/* Delete Task Group Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setDeleteGroupId(null);
          setTargetGroupId("");
        }}
      >
        <Stack gap="r4" className="p-r2">
          <Text variant="h5" weight="semibold">
            Delete Task Group
          </Text>
          <Text variant="body-2" color="secondary">
            All tasks in <strong>{taskGroups.find((g) => g.id === deleteGroupId)?.name}</strong>{" "}
            will be moved to the group you select below.
          </Text>

          <Field>
            <Label htmlFor="target-group">Move tasks to</Label>
            <Select
              id="target-group"
              value={targetGroupId}
              onChange={(e) => setTargetGroupId(e.target.value)}
            >
              {taskGroups
                .filter((g) => g.id !== deleteGroupId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </Select>
          </Field>

          <Row gap="r4" justify="end" className="pt-r3">
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeleteGroupId(null);
                setTargetGroupId("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void handleDelete()}
              disabled={!targetGroupId}
            >
              Delete Group
            </Button>
          </Row>
        </Stack>
      </Dialog>
    </>
  );
}

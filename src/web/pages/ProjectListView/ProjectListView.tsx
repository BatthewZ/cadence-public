import { CheckCircle2, CircleDot } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { SearchInput } from "@/web/components/form/SearchInput";
import { Row, Stack } from "@/web/components/layout";
import { Avatar } from "@/web/components/ui/Avatar";
import { Badge } from "@/web/components/ui/Badge";
import { BulkActionBar } from "@/web/components/ui/BulkActionBar";
import { type ColumnDef, DataTable } from "@/web/components/ui/DataTable";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
} from "@/web/components/ui/EmptyState";
import type { Task } from "@/web/contexts/ProjectContext";
import { useProject } from "@/web/contexts/ProjectContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useTaskFilters } from "@/web/hooks/use-task-filters";
import { getPriorityBadgeVariant, getPriorityLabel } from "@/web/util/task-display";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString();
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ProjectListView() {
  const { tasks, taskGroups } = useProject();
  const { filteredTasks: filterBarTasks } = useTaskFilters(tasks);
  const { members } = useWorkspace();
  const [, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set());
  const selectedIds = useMemo(
    () => new Set(Array.from(selectedKeys, String)),
    [selectedKeys],
  );

  // Build lookups
  const groupMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of taskGroups) {
      map.set(g.id, g.name);
    }
    return map;
  }, [taskGroups]);

  const memberMap = useMemo(() => {
    const map = new Map<string, { name: string; image?: string | null }>();
    for (const m of members) {
      const name = m.user?.name ?? "Unknown";
      const image = m.user?.image ?? null;
      const userId = m.userId ?? m.id;
      map.set(userId, { name, image });
    }
    return map;
  }, [members]);

  // Filter tasks by search query (layered on top of filter bar)
  const filteredTasks = useMemo(() => {
    if (!search.trim()) return filterBarTasks;
    const q = search.toLowerCase();
    return filterBarTasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.assigneeId && memberMap.get(t.assigneeId)?.name.toLowerCase().includes(q)) ||
        (t.taskGroupId && groupMap.get(t.taskGroupId)?.toLowerCase().includes(q))
    );
  }, [filterBarTasks, search, memberMap, groupMap]);

  // Open task detail panel
  const openTask = useCallback(
    (taskId: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("task", taskId);
        return next;
      });
    },
    [setSearchParams]
  );

  // Column definitions
  const columns: ColumnDef<Task>[] = useMemo(
    () => [
      {
        key: "title",
        header: "Title",
        sortable: true,
        render: (row) => (
          <button
            type="button"
            className="text-left text-accent hover:underline font-semibold cursor-pointer bg-transparent border-none p-0"
            onClick={() => openTask(row.id)}
          >
            {row.title}
          </button>
        ),
      },
      {
        key: "taskGroupId",
        header: "Group",
        sortable: true,
        render: (row) => {
          const name = row.taskGroupId ? groupMap.get(row.taskGroupId) : null;
          return name ? <Badge>{name}</Badge> : <span className="text-fg-muted">-</span>;
        },
      },
      {
        key: "assigneeId",
        header: "Assigned to",
        sortable: true,
        render: (row) => {
          if (!row.assigneeId) {
            return <span className="text-fg-muted">Unassigned</span>;
          }
          const member = memberMap.get(row.assigneeId);
          if (!member) {
            return <span className="text-fg-muted">Unknown</span>;
          }
          return (
            <div className="flex items-center gap-r5">
              <Avatar size="xs" name={member.name} src={member.image} />
              <span>{member.name}</span>
            </div>
          );
        },
      },
      {
        key: "priority",
        header: "Priority",
        sortable: true,
        render: (row) => (
          <Badge variant={getPriorityBadgeVariant(row.priority)}>
            {getPriorityLabel(row.priority)}
          </Badge>
        ),
      },
      {
        key: "completed",
        header: "Status",
        sortable: true,
        render: (row) =>
          row.completed ? (
            <span className="inline-flex items-center gap-1.5 text-status-success font-medium text-[0.8125rem]">
              <CheckCircle2 size={14} />
              Done
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-fg-muted text-[0.8125rem]">
              <CircleDot size={14} />
              Active
            </span>
          ),
      },
      {
        key: "dueDate",
        header: "Due Date",
        sortable: true,
        render: (row) => (
          <span className="text-fg-secondary">{formatDate(row.dueDate)}</span>
        ),
      },
    ],
    [groupMap, memberMap, openTask]
  );

  return (
    <Stack gap="r4">
      <Row justify="between" align="center">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search tasks..."
        />
      </Row>

      {filteredTasks.length === 0 && !search ? (
        <EmptyState size="lg">
          <EmptyStateTitle>No tasks yet</EmptyStateTitle>
          <EmptyStateDescription>
            Create your first task to get started.
          </EmptyStateDescription>
        </EmptyState>
      ) : (
        <DataTable<Task>
          data={filteredTasks}
          columns={columns}
          rowKey={(row) => row.id}
          selectable
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          emptyContent={
            <EmptyState size="md">
              <EmptyStateTitle>No matching tasks</EmptyStateTitle>
              <EmptyStateDescription>
                Try adjusting your search query.
              </EmptyStateDescription>
            </EmptyState>
          }
        />
      )}
      <BulkActionBar
        selectedIds={selectedIds}
        onClearSelection={() => setSelectedKeys(new Set())}
      />
    </Stack>
  );
}

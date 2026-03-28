import {
  User,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Checkbox } from "@/web/components/form/Checkbox";
import { SearchInput } from "@/web/components/form/SearchInput";
import { Badge } from "@/web/components/ui/Badge";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import type { ProjectMember } from "@/web/contexts/ProjectContext";
import {
  type UseTaskFiltersReturn,
} from "@/web/hooks/use-task-filters";

export function AssigneeFilter({
  members,
  filtersReturn,
}: {
  members: ProjectMember[];
  filtersReturn: UseTaskFiltersReturn;
}) {
  const { filters, setFilter } = filtersReturn;
  const [search, setSearch] = useState("");
  const isActive = filters.assigneeIds.length > 0;

  const filtered = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q),
    );
  }, [members, search]);

  function toggle(userId: string) {
    const next = filters.assigneeIds.includes(userId)
      ? filters.assigneeIds.filter((id) => id !== userId)
      : [...filters.assigneeIds, userId];
    setFilter("assigneeIds", next);
  }

  return (
    <Popover placement="bottom-start">
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`task-filter-bar__trigger ${isActive ? "task-filter-bar__trigger--active" : ""}`}
        >
          <User size={14} />
          Assigned to
          {isActive && (
            <Badge variant="info" className="task-filter-bar__count">
              {filters.assigneeIds.length}
            </Badge>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content className="task-filter-bar__popover">
        <Text variant="body-3" weight="semibold" className="mb-2">
          Filter by person
        </Text>
        {members.length > 5 && (
          <SearchInput
            value={search}
            onChange={setSearch}
            size="sm"
            placeholder="Search members..."
            className="mb-2"
          />
        )}
        <div className="task-filter-bar__popover-list">
          {filtered.map((member) => (
            <label
              key={member.userId}
              className="task-filter-bar__option"
            >
              <Checkbox
                checked={filters.assigneeIds.includes(member.userId)}
                onChange={() => toggle(member.userId)}
              />
              <span className="truncate">{member.name}</span>
            </label>
          ))}
          {filtered.length === 0 && (
            <Text variant="body-3" color="muted">No members found</Text>
          )}
        </div>
      </Popover.Content>
    </Popover>
  );
}

import {
  User,
  UserX,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Checkbox } from "@/web/components/form/Checkbox";
import { SearchInput } from "@/web/components/form/SearchInput";
import { Badge } from "@/web/components/ui/Badge";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import type { ProjectMember } from "@/web/contexts/ProjectContext";
import {
  FILTER_NONE,
  type UseTaskFiltersReturn,
} from "@/web/hooks/use-task-filters";
import { toggleArrayValue } from "@/web/util/array";

/**
 * Assignee filter popover: a pinned "Unassigned" option above the searchable
 * project-member list.
 *
 * The "Unassigned" row is deliberately rendered OUTSIDE both the member
 * search filter and the scrollable member list: absence-of-assignee is a
 * filter concept, not a member, so it must stay visible when the search text
 * matches no member name and must not scroll away in long member lists.
 * Toggling it XORs the {@link FILTER_NONE} sentinel into
 * `filters.assigneeIds` — the encoding `applyFilters` understands as
 * "assigned to X OR unassigned" within the single assignee dimension — so the
 * trigger badge counts it like any other selection for free.
 */
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

  /**
   * XORs a value into/out of `assigneeIds`. Takes both real member user IDs
   * and the {@link FILTER_NONE} sentinel — sharing one code path keeps the
   * "Unassigned" option's toggle semantics identical to a member row's.
   */
  function toggle(value: string) {
    setFilter("assigneeIds", toggleArrayValue(filters.assigneeIds, value));
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
        {/* Pinned: stays visible regardless of search text or list scroll. */}
        <div className="mb-1 border-b border-border-default pb-1">
          <label className="task-filter-bar__option">
            <Checkbox
              checked={filters.assigneeIds.includes(FILTER_NONE)}
              onChange={() => toggle(FILTER_NONE)}
            />
            <UserX size={14} aria-hidden="true" />
            <span className="truncate">Unassigned</span>
          </label>
        </div>
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

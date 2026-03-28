import { Check } from "lucide-react";
import { useMemo, useState } from "react";

import type { TaskPriority } from "@/shared/types/roles";
import { SearchInput } from "@/web/components/form/SearchInput";
import { Avatar } from "@/web/components/ui/Avatar";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import type { TaskGroup } from "@/web/contexts/ProjectContext";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { cn } from "@/web/util/style/style";
import { PRIORITY_LABEL, PRIORITY_OPTIONS } from "@/web/util/task-display";

import { AssigneeChip, GroupChip, PriorityDot } from "./PropertyDisplays";

export function PriorityPicker({
  value,
  onSelect,
}: {
  value: TaskPriority;
  onSelect: (priority: TaskPriority) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover placement="bottom-start" portal={false} open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="task-property-picker__trigger">
          <PriorityDot priority={value} />
          <span className="task-property-picker__label">{PRIORITY_LABEL[value]}</span>
        </button>
      </Popover.Trigger>
      <Popover.Content className="task-property-picker__popover">
        <Text variant="body-3" weight="semibold" className="mb-2">
          Priority
        </Text>
        <div className="task-property-picker__list">
          {PRIORITY_OPTIONS.map((opt) => {
            const isActive = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  "task-property-picker__option",
                  isActive && "task-property-picker__option--active"
                )}
                onClick={() => {
                  onSelect(opt.value);
                  setOpen(false);
                }}
              >
                <PriorityDot priority={opt.value} />
                <span className="task-property-picker__label">{opt.label}</span>
                {isActive && <Check size={14} className="task-property-picker__check" />}
              </button>
            );
          })}
        </div>
      </Popover.Content>
    </Popover>
  );
}

export function PriorityPickerReadOnly({ value }: { value: TaskPriority }) {
  return (
    <div className="task-property-picker__trigger" style={{ cursor: "default" }}>
      <PriorityDot priority={value} />
      <span className="task-property-picker__label">{PRIORITY_LABEL[value]}</span>
    </div>
  );
}

export function GroupPicker({
  value,
  taskGroups,
  onSelect,
}: {
  value: string;
  taskGroups: TaskGroup[];
  onSelect: (groupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentGroup = taskGroups.find((g) => g.id === value);

  return (
    <Popover placement="bottom-start" portal={false} open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="task-property-picker__trigger">
          <GroupChip group={currentGroup} />
        </button>
      </Popover.Trigger>
      <Popover.Content className="task-property-picker__popover">
        <Text variant="body-3" weight="semibold" className="mb-2">
          Group
        </Text>
        <div className="task-property-picker__list">
          {taskGroups.map((g) => {
            const isActive = g.id === value;
            return (
              <button
                key={g.id}
                type="button"
                className={cn(
                  "task-property-picker__option",
                  isActive && "task-property-picker__option--active"
                )}
                onClick={() => {
                  onSelect(g.id);
                  setOpen(false);
                }}
              >
                <GroupChip group={g} />
                {isActive && <Check size={14} className="task-property-picker__check" />}
              </button>
            );
          })}
        </div>
      </Popover.Content>
    </Popover>
  );
}

export function GroupPickerReadOnly({ value, taskGroups }: { value: string; taskGroups: TaskGroup[] }) {
  const currentGroup = taskGroups.find((g) => g.id === value);
  return (
    <div className="task-property-picker__trigger" style={{ cursor: "default" }}>
      <GroupChip group={currentGroup} />
    </div>
  );
}

export function AssigneePicker({
  value,
  members,
  onSelect,
}: {
  value: string | null;
  members: WorkspaceMember[];
  onSelect: (userId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const currentMember = value ? members.find((m) => m.userId === value) : undefined;

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(
      (m) => m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q)
    );
  }, [members, search]);

  return (
    <Popover
      placement="bottom-start"
      portal={false}
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSearch("");
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" className="task-property-picker__trigger">
          <AssigneeChip member={currentMember} />
        </button>
      </Popover.Trigger>
      <Popover.Content className="task-property-picker__popover">
        <Text variant="body-3" weight="semibold" className="mb-2">
          Assign to
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

        <div className="task-property-picker__list">
          {/* Unassigned option */}
          <button
            type="button"
            className={cn(
              "task-property-picker__option",
              value === null && "task-property-picker__option--active"
            )}
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
          >
            <AssigneeChip member={undefined} />
            {value === null && <Check size={14} className="task-property-picker__check" />}
          </button>

          {filteredMembers.map((m) => {
            const isActive = m.userId === value;
            return (
              <button
                key={m.userId}
                type="button"
                className={cn(
                  "task-property-picker__option",
                  isActive && "task-property-picker__option--active"
                )}
                onClick={() => {
                  onSelect(m.userId);
                  setOpen(false);
                }}
              >
                <Avatar size="xs" name={m.user.name} src={m.user.image} />
                <span className="task-property-picker__label">{m.user.name}</span>
                {isActive && <Check size={14} className="task-property-picker__check" />}
              </button>
            );
          })}

          {filteredMembers.length === 0 && search.trim() && (
            <Text variant="body-3" color="muted" className="py-2 text-center">
              No members found
            </Text>
          )}
        </div>
      </Popover.Content>
    </Popover>
  );
}

export function AssigneePickerReadOnly({
  value,
  members,
}: {
  value: string | null;
  members: WorkspaceMember[];
}) {
  const currentMember = value ? members.find((m) => m.userId === value) : undefined;
  return (
    <div className="task-property-picker__trigger" style={{ cursor: "default" }}>
      <AssigneeChip member={currentMember} />
    </div>
  );
}

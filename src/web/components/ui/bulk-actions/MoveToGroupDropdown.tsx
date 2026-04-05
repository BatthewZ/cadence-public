import { ArrowRight } from "lucide-react";

import type { TaskGroup } from "@/web/contexts/ProjectContext";

import { Button } from "../Button";
import { DropdownMenu } from "../DropdownMenu";

export function MoveToGroupDropdown({
  taskGroups,
  onSelect,
}: {
  taskGroups: TaskGroup[];
  onSelect: (groupId: string) => void;
}) {
  return (
    <DropdownMenu placement="top-start">
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="sm">
          <ArrowRight size={14} />
          <span className="hidden sm:inline ml-1">Move</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="min-w-[10rem]">
        {taskGroups.map((group, i) => (
          <DropdownMenu.Item
            key={group.id}
            index={i}
            icon={
              group.isCompletionGroup ? (
                <span className="size-2 rounded-full bg-status-success" />
              ) : group.color ? (
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
              ) : (
                <span className="size-2 rounded-full bg-surface-3" />
              )
            }
            onSelect={() => void onSelect(group.id)}
          >
            {group.name}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

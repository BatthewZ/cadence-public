import { Flag } from "lucide-react";

import type { TaskPriority } from "@/shared/types/roles";
import { PRIORITY_DOT_CLASS, PRIORITY_OPTIONS } from "@/web/util/task-display";

import { Button } from "../Button";
import { DropdownMenu } from "../DropdownMenu";

export function PriorityDropdown({ onSelect }: { onSelect: (p: TaskPriority) => void }) {
  return (
    <DropdownMenu placement="top-start">
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="sm">
          <Flag size={14} />
          <span className="hidden sm:inline ml-1">Priority</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="min-w-[140px]">
        {PRIORITY_OPTIONS.map((opt, i) => (
          <DropdownMenu.Item
            key={opt.value}
            index={i}
            icon={
              <span
                className={`size-2 rounded-full ${PRIORITY_DOT_CLASS[opt.value] ?? "bg-surface-3"}`}
              />
            }
            onSelect={() => void onSelect(opt.value)}
          >
            {opt.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

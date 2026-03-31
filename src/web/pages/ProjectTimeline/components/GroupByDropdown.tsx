import { Calendar, Columns3, Flag, Users } from "lucide-react";
import type { ReactElement } from "react";

import { DropdownMenu } from "@/web/components/ui/DropdownMenu";

import type { GroupingMode } from "./grouping";

const GROUPING_OPTIONS: Array<{
  value: GroupingMode;
  label: string;
  icon: ReactElement;
}> = [
  { value: "dueDate", label: "Due Date", icon: <Calendar size={14} /> },
  { value: "priority", label: "Priority", icon: <Flag size={14} /> },
  { value: "taskGroup", label: "Task Group", icon: <Columns3 size={14} /> },
  { value: "assignee", label: "Assignee", icon: <Users size={14} /> },
];

export function GroupByDropdown({
  value,
  onChange,
}: {
  value: GroupingMode;
  onChange: (mode: GroupingMode) => void;
}) {
  const current = GROUPING_OPTIONS.find((o) => o.value === value)!;

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="task-filter-bar__trigger"
        >
          {current.icon}
          Group: {current.label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="min-w-[160px]">
        <DropdownMenu.Label>Group by</DropdownMenu.Label>
        {GROUPING_OPTIONS.map((opt, i) => (
          <DropdownMenu.Item
            key={opt.value}
            index={i}
            icon={opt.icon}
            onSelect={() => onChange(opt.value)}
          >
            <span className={value === opt.value ? "font-semibold" : ""}>
              {opt.label}
            </span>
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

import { Check, UserCircle } from "lucide-react";

import type { TaskPriority } from "@/shared/types/roles";
import { Avatar } from "@/web/components/ui/Avatar";
import type { TaskGroup } from "@/web/contexts/ProjectContext";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { cn } from "@/web/util/style/style";
import { PRIORITY_DOT_CLASS } from "@/web/util/task-display";

export function PriorityDot({ priority }: { priority: TaskPriority }) {
  const dotClass = PRIORITY_DOT_CLASS[priority] || "";
  return dotClass ? (
    <span className={cn("task-property-picker__dot", dotClass)} />
  ) : (
    <span className="task-property-picker__dot bg-surface-3 opacity-40" />
  );
}

export function GroupChip({ group }: { group: TaskGroup | undefined }) {
  return (
    <>
      <span
        className="task-property-picker__dot"
        style={{ backgroundColor: group?.color ?? "var(--C-SURFACE-3)" }}
      />
      <span className="task-property-picker__label">{group?.name ?? "Unknown"}</span>
      {group?.isCompletionGroup && (
        <span className="task-property-picker__completion-badge">
          <Check size={12} />
        </span>
      )}
    </>
  );
}

export function AssigneeChip({ member }: { member: WorkspaceMember | undefined }) {
  return member ? (
    <>
      <Avatar size="xs" name={member.user.name} src={member.user.image} />
      <span className="task-property-picker__label">{member.user.name}</span>
    </>
  ) : (
    <>
      <span className="task-property-picker__unassigned-icon">
        <UserCircle size={14} />
      </span>
      <span className="task-property-picker__label text-fg-muted">Unassigned</span>
    </>
  );
}

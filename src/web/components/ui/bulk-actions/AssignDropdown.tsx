import { UserPlus } from "lucide-react";

import { Avatar } from "../Avatar";
import { Button } from "../Button";
import { DropdownMenu } from "../DropdownMenu";

export function AssignDropdown({
  members,
  onSelect,
}: {
  members: Array<{ userId: string; name: string; image: string | null }>;
  onSelect: (assigneeId: string | null, name?: string) => void;
}) {
  return (
    <DropdownMenu placement="top-start">
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="sm">
          <UserPlus size={14} />
          <span className="hidden sm:inline ml-1">Assign</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="min-w-[160px] max-h-[240px] overflow-y-auto">
        <DropdownMenu.Item index={0} onSelect={() => void onSelect(null)}>
          Unassigned
        </DropdownMenu.Item>
        <DropdownMenu.Divider />
        {members.map((m, i) => (
          <DropdownMenu.Item
            key={m.userId}
            index={i + 1}
            icon={<Avatar size="xs" name={m.name} src={m.image} />}
            onSelect={() => void onSelect(m.userId, m.name)}
          >
            {m.name}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

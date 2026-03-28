import { UserMinus } from "lucide-react";

import { ROLE_LABELS } from "@/shared/types/roles";
import { Row } from "@/web/components/layout";
import {
  Avatar,
  Badge,
  Button,
  type ColumnDef,
  DropdownMenu,
  Text,
} from "@/web/components/ui";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";
import { getRoleBadgeVariant } from "@/web/util/role-display";

export function getMemberColumns({
  canManageWorkspace,
  onChangeRole,
  onRemoveMember,
}: {
  canManageWorkspace: boolean;
  onChangeRole: (member: WorkspaceMember) => void;
  onRemoveMember: (member: WorkspaceMember) => void;
}): ColumnDef<WorkspaceMember>[] {
  return [
    {
      key: "name",
      header: "Member",
      render: (row) => (
        <Row gap="r5" align="center">
          <Avatar src={row.user.image} name={row.user.name} size="sm" />
          <Text variant="body-2" weight="semibold">{row.user.name}</Text>
        </Row>
      ),
    },
    {
      key: "email",
      header: "Email",
      className: "hidden md:table-cell",
      render: (row) => (
        <Text variant="body-2" color="secondary" className="truncate max-w-48">{row.user.email}</Text>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <Badge variant={getRoleBadgeVariant(row.role)}>{ROLE_LABELS[row.role]}</Badge>
      ),
    },
    {
      key: "joinedAt",
      header: "Joined",
      className: "hidden sm:table-cell",
      render: (row) => (
        <Text variant="body-3" color="muted">
          {row.joinedAt ? new Date(row.joinedAt).toLocaleDateString() : "-"}
        </Text>
      ),
    },
    ...(canManageWorkspace
      ? [
          {
            key: "actions",
            header: "",
            width: 48,
            align: "right" as const,
            render: (row: WorkspaceMember, index: number) =>
              row.role === "owner" ? null : (
                <DropdownMenu>
                  <DropdownMenu.Trigger asChild>
                    <Button variant="ghost" size="sm">
                      ...
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    <DropdownMenu.Item
                      index={index * 2}
                      onSelect={() => {
                        onChangeRole(row);
                      }}
                    >
                      Change Role
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      index={index * 2 + 1}
                      variant="danger"
                      icon={<UserMinus size={14} />}
                      onSelect={() => {
                        onRemoveMember(row);
                      }}
                    >
                      Remove
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu>
              ),
          } satisfies ColumnDef<WorkspaceMember>,
        ]
      : []),
  ];
}

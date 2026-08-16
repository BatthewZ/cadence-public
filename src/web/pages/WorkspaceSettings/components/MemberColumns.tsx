import { UserCog, UserMinus } from "lucide-react";

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

/**
 * Whether the viewer may remove `row`, mirroring the server's rank rule
 * (`outranks()` in `workspaces.handlers.ts`: strictly senior actor only).
 *
 * Owner removes admins and members; admin removes plain members only; the
 * owner's row is removable by nobody, and neither is your own — an admin's own
 * row is an `admin` row, which this already refuses.
 *
 * The server is the authority; this exists so the menu does not advertise an
 * action that can only ever come back 403. Before it, an admin was shown
 * "Remove" on a peer admin's row and on their own.
 */
function canRemoveMember(row: WorkspaceMember, isWorkspaceOwner: boolean): boolean {
  if (row.role === "owner") return false;
  return isWorkspaceOwner || row.role !== "admin";
}

/**
 * Whether the viewer may change `row`'s role.
 *
 * Owner-only, and that is the whole rule rather than a conservative rounding:
 * the workspace roles an API caller can set are `admin` and `member`, granting
 * `admin` is owner-only, and touching an existing admin is owner-only. An admin
 * therefore has exactly one legal submission — setting a plain member's role to
 * `member` — which is a no-op the server accepts with 200 and which changes
 * nothing. Offering the item to an admin opens a dialog whose only selectable
 * option is the role the member already has.
 */
function canChangeMemberRole(row: WorkspaceMember, isWorkspaceOwner: boolean): boolean {
  return isWorkspaceOwner && row.role !== "owner";
}

export function getMemberColumns({
  canManageWorkspace,
  isWorkspaceOwner,
  onChangeRole,
  onRemoveMember,
}: {
  canManageWorkspace: boolean;
  isWorkspaceOwner: boolean;
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
            render: (row: WorkspaceMember) => {
              const showChangeRole = canChangeMemberRole(row, isWorkspaceOwner);
              const showRemove = canRemoveMember(row, isWorkspaceOwner);

              // An empty menu is worse than no menu: the trigger invites a
              // click and then presents nothing.
              if (!showChangeRole && !showRemove) return null;

              // `DropdownMenu.Item.index` is the item's slot in *this* menu's
              // `listRef`, which drives arrow-key roving focus and typeahead.
              // It must therefore be 0-based and gapless per menu. (It used to
              // be derived from the table row index — `index * 2` — so every
              // row after the first registered its items at slots 2, 3, 4 …
              // behind leading holes, and keyboard navigation opened onto a
              // null element.) Counting only the items actually rendered keeps
              // that true now that either item can be absent.
              const removeIndex = showChangeRole ? 1 : 0;

              return (
                <DropdownMenu>
                  <DropdownMenu.Trigger asChild>
                    <Button variant="ghost" size="sm" aria-label={`Actions for ${row.user.name}`}>
                      ...
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    {showChangeRole && (
                      <DropdownMenu.Item
                        index={0}
                        icon={<UserCog size={14} />}
                        onSelect={() => {
                          onChangeRole(row);
                        }}
                      >
                        Change Role
                      </DropdownMenu.Item>
                    )}
                    {showRemove && (
                      <DropdownMenu.Item
                        index={removeIndex}
                        variant="danger"
                        icon={<UserMinus size={14} />}
                        onSelect={() => {
                          onRemoveMember(row);
                        }}
                      >
                        Remove
                      </DropdownMenu.Item>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu>
              );
            },
          } satisfies ColumnDef<WorkspaceMember>,
        ]
      : []),
  ];
}

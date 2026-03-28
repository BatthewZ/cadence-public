import { useQuery } from "@tanstack/react-query";

import { Row, Stack } from "@/web/components/layout";
import {
  Accordion,
  Avatar,
  Button,
  Card,
  Text,
} from "@/web/components/ui";
import type { WorkspaceMember, WorkspaceTeam } from "@/web/contexts/WorkspaceContext";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

interface TeamDetail extends WorkspaceTeam {
  members: WorkspaceMember[];
}

export function TeamCard({
  team,
  workspaceId,
  onEdit,
  onDelete,
  onAddMember,
}: {
  team: WorkspaceTeam;
  workspaceId: string;
  onEdit: () => void;
  onDelete: () => void;
  onAddMember: () => void;
}) {
  const { data: teamDetail } = useQuery({
    queryKey: queryKeys.workspaces.teamDetail(workspaceId, team.id),
    queryFn: () => api.get<TeamDetail>(`/api/workspaces/${workspaceId}/teams/${team.id}`),
  });

  const teamMembers = teamDetail?.members ?? [];

  return (
    <Card className="mb-r5">
      <Accordion.Item value={team.id}>
        <Row justify="between" align="center">
          <Stack gap="r6">
            <Accordion.Trigger>
              <Text variant="body-1" weight="semibold">{team.name}</Text>
            </Accordion.Trigger>
            {team.description && (
              <Text variant="body-3" color="muted">{team.description}</Text>
            )}
            <Text variant="body-3" color="secondary">
              {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
            </Text>
          </Stack>
          <Row gap="r5">
            <Button variant="ghost" size="sm" onClick={onAddMember}>
              Add Member
            </Button>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              Delete
            </Button>
          </Row>
        </Row>
        <Accordion.Content>
          <Stack gap="r5" className="pt-r4">
            {teamMembers.length === 0 ? (
              <Text variant="body-3" color="muted">No members in this team yet.</Text>
            ) : (
              teamMembers.map((member) => (
                <Row key={member.id} gap="r4" align="center">
                  <Avatar src={member.user.image} name={member.user.name} size="sm" />
                  <Stack gap="r6">
                    <Text variant="body-2">{member.user.name}</Text>
                    <Text variant="body-3" color="muted">{member.user.email}</Text>
                  </Stack>
                </Row>
              ))
            )}
          </Stack>
        </Accordion.Content>
      </Accordion.Item>
    </Card>
  );
}

import { useNavigate } from "react-router-dom";

import { Container, Stack } from "@/web/components/layout";
import { Alert, Tabs, Text } from "@/web/components/ui";
import { useToast } from "@/web/components/ui/ToastContext";
import { useProject } from "@/web/contexts/ProjectContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useProjectPermissions } from "@/web/hooks/use-permissions";

import { AppearanceTab } from "./components/AppearanceTab";
import { GeneralTab } from "./components/GeneralTab";
import { MembersTab } from "./components/MembersTab";
import { TaskGroupsTab } from "./components/TaskGroupsTab";
import { WebhooksTab } from "./components/WebhooksTab";

export default function ProjectSettings() {
  const { project, members, refetch, updateProject } = useProject();
  useDocumentTitle(`${project.name} — Settings`);
  const { isProjectAdmin } = useProjectPermissions(members);
  const { toast } = useToast();
  const navigate = useNavigate();
  const projectId = project?.id ?? "";

  if (!isProjectAdmin) {
    return (
      <Container size="md">
        <Stack gap="r3" className="py-r2">
          <Alert variant="info">
            You do not have permission to manage project settings.
          </Alert>
        </Stack>
      </Container>
    );
  }

  // Use isProjectAdmin for theme editing as well (admins can edit themes)
  const canEditTheme = isProjectAdmin;

  return (
    <Container size="md">
      <Stack gap="r3" className="py-r2">
        <Text variant="h3">Project Settings</Text>

        <Tabs defaultValue="general" variant="underline">
          <Tabs.List>
            <Tabs.Tab value="general">General</Tabs.Tab>
            <Tabs.Tab value="members">Members</Tabs.Tab>
            <Tabs.Tab value="taskgroups">Task Groups</Tabs.Tab>
            <Tabs.Tab value="webhooks">Webhooks</Tabs.Tab>
            {canEditTheme && <Tabs.Tab value="appearance">Appearance</Tabs.Tab>}
          </Tabs.List>

          <Tabs.Panel value="general">
            <Stack gap="r3" className="pt-r3">
              <GeneralTab
                projectId={projectId}
                project={project}
                refetch={refetch}
                updateProject={updateProject}
                toast={toast}
                navigate={navigate}
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="members">
            <Stack gap="r3" className="pt-r3">
              <MembersTab projectId={projectId} project={project} refetch={refetch} toast={toast} />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="taskgroups">
            <Stack gap="r3" className="pt-r3">
              <TaskGroupsTab
                projectId={projectId}
                toast={toast}
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="webhooks">
            <Stack gap="r3" className="pt-r3">
              <WebhooksTab projectId={projectId} toast={toast} />
            </Stack>
          </Tabs.Panel>

          {canEditTheme && (
            <Tabs.Panel value="appearance">
              <Stack gap="r3" className="pt-r3">
                <AppearanceTab
                  projectId={projectId}
                  project={project}
                  refetch={refetch}
                  toast={toast}
                />
              </Stack>
            </Tabs.Panel>
          )}
        </Tabs>
      </Stack>
    </Container>
  );
}

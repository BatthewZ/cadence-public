import { Container, Stack } from "@/web/components/layout";
import { Text } from "@/web/components/ui";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";

import { ApiTokensTab } from "./components/ApiTokensTab";
import { SettingsNav } from "./SettingsNav";

/* ------------------------------------------------------------------ */
/*  WorkspaceApiTokens                                                 */
/*                                                                     */
/*  Thin page wrapper: provides the Settings chrome (breadcrumbs,      */
/*  heading, tab nav) and delegates the tab body to ApiTokensTab.      */
/*  Mirrors the WorkspaceWebhooks / WorkspaceMembers pattern so the    */
/*  visual rhythm of the settings surface stays consistent.            */
/* ------------------------------------------------------------------ */

export default function WorkspaceApiTokens() {
  const { workspace } = useWorkspace();
  useDocumentTitle(`${workspace.name} — API Tokens`);

  return (
    <Container size="lg">
      <Stack gap="r3" className="py-r2">
        <Breadcrumbs>
          <Breadcrumbs.Item href={`/w/${workspace.slug}/dashboard`}>
            {workspace.name}
          </Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/w/${workspace.slug}/settings`}>
            Settings
          </Breadcrumbs.Item>
          <Breadcrumbs.Item current>API Tokens</Breadcrumbs.Item>
        </Breadcrumbs>
        <Text variant="h3">Workspace Settings</Text>
        <SettingsNav basePath={`/w/${workspace.slug}/settings`} />

        <ApiTokensTab workspaceId={workspace.id} />
      </Stack>
    </Container>
  );
}

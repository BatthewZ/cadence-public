import { AuthenticatedLayout, Container, Divider, Stack } from "@/web/components/layout";
import { Text } from "@/web/components/ui";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import { useOptionalWorkspace } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";

import { DangerZoneSection } from "./components/DangerZoneSection";
import { PasswordSection } from "./components/PasswordSection";
import { ProfileSection } from "./components/ProfileSection";
import { SessionsSection } from "./components/SessionsSection";

export function Settings() {
  useDocumentTitle("Account Settings");
  const workspaceCtx = useOptionalWorkspace();
  const isInsideWorkspace = workspaceCtx !== null;

  const content = (
    <Container size={isInsideWorkspace ? "xl" : "lg"}>
      <Stack gap="r3" className="py-r2">
        {isInsideWorkspace && workspaceCtx && (
          <Breadcrumbs>
            <Breadcrumbs.Item href={`/w/${workspaceCtx.workspace.slug}/dashboard`}>{workspaceCtx.workspace.name}</Breadcrumbs.Item>
            <Breadcrumbs.Item current>Account</Breadcrumbs.Item>
          </Breadcrumbs>
        )}
        <Text variant="h3">Account Settings</Text>
        <ProfileSection />
        <Divider />
        <PasswordSection />
        <Divider />
        <SessionsSection />
        <Divider />
        <DangerZoneSection />
      </Stack>
    </Container>
  );

  // When rendered inside WorkspaceLayout, skip the AuthenticatedLayout wrapper
  if (isInsideWorkspace) {
    return content;
  }

  // Standalone mode: render with its own layout
  return <AuthenticatedLayout>{content}</AuthenticatedLayout>;
}

export default Settings;

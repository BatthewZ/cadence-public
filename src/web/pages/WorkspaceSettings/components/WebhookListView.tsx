import { AlertTriangle, Webhook } from "lucide-react";

import { Container, Row, Stack } from "@/web/components/layout";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  Spinner,
  Text,
} from "@/web/components/ui";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import {
  parseEvents,
  projectName,
  type UseWorkspaceWebhooksReturn,
} from "@/web/hooks/use-workspace-webhooks";

import { SettingsNav } from "../SettingsNav";
import { CreateWebhookDialog } from "./CreateWebhookDialog";

/* ------------------------------------------------------------------ */
/*  WebhookListView                                                    */
/*                                                                     */
/*  Renders the webhook list (the "else" branch when no webhook is     */
/*  selected). Receives all state and handlers from the hook.          */
/* ------------------------------------------------------------------ */

export function WebhookListView({ hook }: { hook: UseWorkspaceWebhooksReturn }) {
  const {
    workspace,
    projects,
    activeProjects,
    canManageWorkspace,
    webhooks,
    listLoading,
    listError,
    handleOpenCreate,
    handleCloseCreate,
    handleCreate,
    handleSelectWebhook,
    createDialogOpen,
    createForm,
    createMutation,
    handleCopiedSecret,
  } = hook;

  return (
    <Container size="lg">
      <Stack gap="r3" className="py-r2">
        <Breadcrumbs>
          <Breadcrumbs.Item href={`/w/${workspace.slug}/dashboard`}>
            {workspace.name}
          </Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/w/${workspace.slug}/settings`}>Settings</Breadcrumbs.Item>
          <Breadcrumbs.Item current>Webhooks</Breadcrumbs.Item>
        </Breadcrumbs>
        <Text variant="h3">Workspace Settings</Text>
        <SettingsNav basePath={`/w/${workspace.slug}/settings`} />

        <Row justify="between" align="center">
          <Stack gap="r6">
            <Text variant="h5">Webhooks</Text>
            <Text variant="body-2" color="secondary">
              Receive HTTP callbacks when events happen in your workspace.
            </Text>
          </Stack>
          {canManageWorkspace && (
            <Button variant="primary" size="md" onClick={handleOpenCreate}>
              <Webhook size={16} className="mr-r6" />
              Create Webhook
            </Button>
          )}
        </Row>

        {listError && (
          <Alert variant="error">
            {listError.message || "Failed to load webhooks."}
          </Alert>
        )}

        {listLoading ? (
          <Row justify="center" className="py-r1">
            <Spinner size="lg" />
          </Row>
        ) : webhooks.length === 0 ? (
          <EmptyState size="md">
            <EmptyStateTitle>No webhooks</EmptyStateTitle>
            <EmptyStateDescription>
              Create a webhook to start receiving event notifications via HTTP callbacks.
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <Stack gap="r5">
            {webhooks.map((wh) => {
              const events = parseEvents(wh.events);
              return (
                <button
                  key={wh.id}
                  type="button"
                  className="w-full text-left bg-surface-0 rounded-lg border border-border-default/50 shadow-md p-r3 hover:border-accent/40 hover:shadow-lg transition-all duration-fast cursor-pointer focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:outline-none"
                  onClick={() => handleSelectWebhook(wh.id)}
                  aria-label={`View ${wh.name} details`}
                >
                  <Row justify="between" align="center" className="flex-wrap gap-r5">
                    <Row gap="r5" align="center" className="min-w-0 flex-1">
                      <Webhook size={18} className="text-fg-muted shrink-0" />
                      <Stack gap="r6" className="min-w-0">
                        <Row gap="r5" align="center">
                          <Text variant="body-2" weight="semibold" as="span">
                            {wh.name}
                          </Text>
                          {wh.consecutiveFailures > 0 && (
                            <AlertTriangle size={14} className="text-status-warning shrink-0" />
                          )}
                        </Row>
                        <Text
                          variant="body-3"
                          color="muted"
                          as="span"
                          className="font-mono truncate block max-w-80"
                        >
                          {wh.url}
                        </Text>
                      </Stack>
                    </Row>

                    <Row gap="r5" align="center" className="shrink-0">
                      {wh.projectId && (
                        <Badge variant="info">
                          {projectName(projects, wh.projectId) ?? "Project"}
                        </Badge>
                      )}
                      <Text variant="body-3" color="muted" as="span">
                        {events.length} {events.length === 1 ? "event" : "events"}
                      </Text>
                      <Badge variant={wh.active ? "success" : "default"}>
                        {wh.active ? "Active" : "Disabled"}
                      </Badge>
                      {wh.consecutiveFailures > 0 && (
                        <Badge variant="warning">
                          {wh.consecutiveFailures} failures
                        </Badge>
                      )}
                    </Row>
                  </Row>
                </button>
              );
            })}
          </Stack>
        )}
      </Stack>

      {/* Create Dialog */}
      {canManageWorkspace && (
        <CreateWebhookDialog
          open={createDialogOpen}
          onClose={handleCloseCreate}
          name={createForm.name}
          onNameChange={createForm.setName}
          url={createForm.url}
          onUrlChange={createForm.setUrl}
          events={createForm.events}
          onEventsChange={createForm.setEvents}
          projectId={createForm.projectId}
          onProjectIdChange={createForm.setProjectId}
          projects={activeProjects}
          newSecret={createForm.secret}
          onCopiedSecret={handleCopiedSecret}
          isPending={createMutation.isPending}
          errorMessage={createMutation.error?.message}
          onSubmit={(e) => void handleCreate(e)}
        />
      )}
    </Container>
  );
}

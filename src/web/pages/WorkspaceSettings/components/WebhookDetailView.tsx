import { ChevronLeft, Play, Trash2 } from "lucide-react";

import { Container, Divider, Row, Stack } from "@/web/components/layout";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
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
import { DeleteWebhookDialog } from "./DeleteWebhookDialog";
import { EditWebhookDialog } from "./EditWebhookDialog";
import { TestResultDisplay } from "./TestResultDisplay";
import { deliveryColumns } from "./WebhookColumns";

/* ------------------------------------------------------------------ */
/*  WebhookDetailView                                                  */
/*                                                                     */
/*  Renders the detail view for a selected webhook (config summary,    */
/*  recent deliveries, edit/delete/test actions). All state and        */
/*  handlers are received from the hook.                               */
/* ------------------------------------------------------------------ */

export function WebhookDetailView({ hook }: { hook: UseWorkspaceWebhooksReturn }) {
  const {
    workspace,
    projects,
    activeProjects,
    canManageWorkspace,
    handleSelectWebhook,
    editDialogOpen,
    deleteTarget,
    setDeleteTarget,
    editForm,
    editFieldErrors,
    testResult,
    testingId,
    detailWebhook: wh,
    deliveries,
    detailLoading,
    updateMutation,
    deleteMutation,
    handleOpenEdit,
    handleCloseEdit,
    handleUpdate,
    handleRegenerateSecret,
    handleTest,
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
          <Breadcrumbs.Item href={`/w/${workspace.slug}/settings/webhooks`}>
            Webhooks
          </Breadcrumbs.Item>
          <Breadcrumbs.Item current>{wh?.name ?? "Detail"}</Breadcrumbs.Item>
        </Breadcrumbs>
        <Text variant="h3">Workspace Settings</Text>
        <SettingsNav basePath={`/w/${workspace.slug}/settings`} />

        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleSelectWebhook(null)}
          className="self-start"
        >
          <ChevronLeft size={16} className="mr-r6" />
          Back to Webhooks
        </Button>

        {detailLoading && !wh ? (
          <Row justify="center" className="py-r1">
            <Spinner size="lg" />
          </Row>
        ) : !wh ? (
          <Alert variant="error">Webhook not found.</Alert>
        ) : (
          <Stack gap="r3">
            {/* Config summary */}
            <Card>
              <Stack gap="r4">
                <Row justify="between" align="center">
                  <Text variant="h5">{wh.name}</Text>
                  <Row gap="r5">
                    <Badge variant={wh.active ? "success" : "default"}>
                      {wh.active ? "Active" : "Disabled"}
                    </Badge>
                    {wh.consecutiveFailures > 0 && (
                      <Badge variant="warning">
                        {wh.consecutiveFailures} consecutive failures
                      </Badge>
                    )}
                  </Row>
                </Row>

                <Divider />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-r4">
                  <div>
                    <Text variant="body-3" color="muted">
                      URL
                    </Text>
                    <Text variant="body-2" className="font-mono break-all mt-r6">
                      {wh.url}
                    </Text>
                  </div>
                  <div>
                    <Text variant="body-3" color="muted">
                      Scope
                    </Text>
                    <Text variant="body-2" className="mt-r6">
                      {wh.projectId
                        ? projectName(projects, wh.projectId) ?? "Specific project"
                        : "All projects"}
                    </Text>
                  </div>
                  <div className="md:col-span-2">
                    <Text variant="body-3" color="muted">
                      Subscribed Events
                    </Text>
                    <div className="flex flex-wrap gap-r6 mt-r6">
                      {parseEvents(wh.events).map((evt) => (
                        <Badge key={evt} variant="info">
                          {evt}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <Divider />

                <Row gap="r5" className="flex-wrap">
                  {canManageWorkspace && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleOpenEdit(wh)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleTest(wh.id)}
                        disabled={testingId === wh.id}
                      >
                        {testingId === wh.id ? (
                          <Spinner size="sm" className="mr-r6" />
                        ) : (
                          <Play size={14} className="mr-r6" />
                        )}
                        Send Test
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setDeleteTarget(wh)}
                      >
                        <Trash2 size={14} className="mr-r6" />
                        Delete
                      </Button>
                    </>
                  )}
                </Row>

                {/* Test result inline */}
                {testResult && (
                  <TestResultDisplay testResult={testResult} />
                )}
              </Stack>
            </Card>

            {/* Recent deliveries */}
            <Card>
              <Stack gap="r4">
                <Text variant="h5">Recent Deliveries</Text>
                <DataTable
                  data={deliveries}
                  columns={deliveryColumns}
                  rowKey={(row) => row.id}
                  loading={detailLoading}
                  emptyContent={
                    <EmptyState size="sm">
                      <EmptyStateTitle>No deliveries yet</EmptyStateTitle>
                      <EmptyStateDescription>
                        Deliveries will appear here when events are triggered.
                      </EmptyStateDescription>
                    </EmptyState>
                  }
                />
              </Stack>
            </Card>
          </Stack>
        )}
      </Stack>

      {/* Edit Dialog */}
      {canManageWorkspace && (
        <EditWebhookDialog
          open={editDialogOpen}
          onClose={handleCloseEdit}
          name={editForm.name}
          onNameChange={editForm.setName}
          url={editForm.url}
          onUrlChange={editForm.setUrl}
          events={editForm.events}
          onEventsChange={editForm.setEvents}
          active={editForm.active}
          onActiveChange={editForm.setActive}
          projectId={editForm.projectId}
          onProjectIdChange={editForm.setProjectId}
          projects={activeProjects}
          fieldErrors={editFieldErrors.fieldErrors}
          onClearFieldError={editFieldErrors.clearFieldError}
          regeneratedSecret={editForm.secret}
          onCopiedSecret={handleCopiedSecret}
          isPending={updateMutation.isPending}
          errorMessage={updateMutation.error?.message}
          onSubmit={(e) => void handleUpdate(e)}
          onRegenerateSecret={() => void handleRegenerateSecret()}
        />
      )}

      {/* Delete Confirm */}
      <DeleteWebhookDialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleteMutation.isPending) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) void deleteMutation.mutateAsync(deleteTarget.id);
        }}
        webhookName={deleteTarget?.name}
        isPending={deleteMutation.isPending}
      />
    </Container>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronLeft,
  Play,
  Trash2,
  Webhook,
} from "lucide-react";
import { type SyntheticEvent, useState } from "react";

import type { CreateWebhookInput, UpdateWebhookInput } from "@/shared/schemas/webhook";
import type { WebhookEventType } from "@/shared/types/webhook";
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
import { useToast } from "@/web/components/ui/ToastContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useWorkspacePermissions } from "@/web/hooks/use-permissions";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

import { CreateWebhookDialog } from "./components/CreateWebhookDialog";
import { DeleteWebhookDialog } from "./components/DeleteWebhookDialog";
import { EditWebhookDialog } from "./components/EditWebhookDialog";
import { type TestDeliveryResult, TestResultDisplay } from "./components/TestResultDisplay";
import { deliveryColumns, type DeliveryRow } from "./components/WebhookColumns";
import { SettingsNav } from "./SettingsNav";

/* ------------------------------------------------------------------ */
/*  Types (matching API response shapes)                               */
/* ------------------------------------------------------------------ */

interface WebhookRow {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  url: string;
  events: string; // JSON-stringified array
  active: boolean;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
  secret?: string; // only on create / regenerate
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Look up a project name by ID from the projects list. */
function projectName(
  projects: Array<{ id: string; name: string }>,
  projectId: string | null,
): string | null {
  if (!projectId) return null;
  return projects.find((p) => p.id === projectId)?.name ?? null;
}

function parseEvents(raw: string): WebhookEventType[] {
  try {
    return JSON.parse(raw) as WebhookEventType[];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

export default function WorkspaceWebhooks() {
  const { workspace, projects } = useWorkspace();
  const { toast } = useToast();
  const { canManageWorkspace } = useWorkspacePermissions();

  // Only show active projects in webhook selectors — archived/completed projects
  // shouldn't receive new webhooks (archived ones auto-delete their webhooks).
  const activeProjects = projects.filter((p) => p.status === "active");
  const qc = useQueryClient();
  const workspaceId = workspace?.id ?? "";

  // ---- View state ---------------------------------------------------
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRow | null>(null);

  // ---- Create form state --------------------------------------------
  const [createName, setCreateName] = useState("");
  const [createUrl, setCreateUrl] = useState("");
  const [createEvents, setCreateEvents] = useState<WebhookEventType[]>([]);
  const [createProjectId, setCreateProjectId] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  // ---- Edit form state -----------------------------------------------
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editEvents, setEditEvents] = useState<WebhookEventType[]>([]);
  const [editActive, setEditActive] = useState(true);
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const [regeneratedSecret, setRegeneratedSecret] = useState<string | null>(null);

  // ---- Test state ----------------------------------------------------
  const [testResult, setTestResult] = useState<TestDeliveryResult | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  // ==================================================================
  //  Queries
  // ==================================================================

  const {
    data: listData,
    isLoading: listLoading,
    error: listError,
  } = useQuery({
    queryKey: queryKeys.workspaces.webhooks(workspaceId),
    queryFn: () => api.get<{ webhooks: WebhookRow[] }>(`/api/workspaces/${workspaceId}/webhooks`),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
  const webhooks = listData?.webhooks ?? [];

  const {
    data: detailData,
    isLoading: detailLoading,
  } = useQuery({
    queryKey: queryKeys.workspaces.webhookDetail(workspaceId, selectedWebhookId ?? ""),
    queryFn: () =>
      api.get<{ webhook: WebhookRow; deliveries: DeliveryRow[] }>(
        `/api/workspaces/${workspaceId}/webhooks/${selectedWebhookId}`,
      ),
    enabled: !!workspaceId && !!selectedWebhookId,
    staleTime: 15_000,
  });
  const detailWebhook = detailData?.webhook ?? null;
  const deliveries = detailData?.deliveries ?? [];

  // ==================================================================
  //  Mutations
  // ==================================================================

  const createMutation = useMutation({
    mutationFn: (data: CreateWebhookInput) =>
      api.post<{ webhook: WebhookRow }>(`/api/workspaces/${workspaceId}/webhooks`, data),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.webhooks(workspaceId) });
      toast("Webhook created.", { variant: "success" });
      if (result.webhook.secret) {
        setNewSecret(result.webhook.secret);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: UpdateWebhookInput & { id: string }) =>
      api.patch<{ webhook: WebhookRow }>(
        `/api/workspaces/${workspaceId}/webhooks/${id}`,
        data,
      ),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.webhooks(workspaceId) });
      if (selectedWebhookId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.workspaces.webhookDetail(workspaceId, selectedWebhookId),
        });
      }
      toast("Webhook updated.", { variant: "success" });
      if (result.webhook.secret) {
        setRegeneratedSecret(result.webhook.secret);
      } else {
        setEditDialogOpen(false);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/api/workspaces/${workspaceId}/webhooks/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.webhooks(workspaceId) });
      toast("Webhook deleted.", { variant: "success" });
      setDeleteTarget(null);
      if (selectedWebhookId === deleteTarget?.id) {
        setSelectedWebhookId(null);
      }
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ delivery: TestDeliveryResult | null }>(
        `/api/workspaces/${workspaceId}/webhooks/${id}/test`,
        {},
      ),
    onSuccess: (result) => {
      setTestResult(result.delivery ?? null);
      void qc.invalidateQueries({
        queryKey: queryKeys.workspaces.webhookDetail(workspaceId, selectedWebhookId ?? ""),
      });
    },
    onError: () => {
      toast("Test delivery failed.", { variant: "error" });
    },
  });

  // ==================================================================
  //  Handlers
  // ==================================================================

  function handleOpenCreate() {
    setCreateName("");
    setCreateUrl("");
    setCreateEvents([]);
    setCreateProjectId(null);
    setNewSecret(null);
    createMutation.reset();
    setCreateDialogOpen(true);
  }

  function handleCloseCreate() {
    setCreateDialogOpen(false);
    setNewSecret(null);
  }

  async function handleCreate(e: SyntheticEvent) {
    e.preventDefault();
    if (!createName.trim() || !createUrl.trim() || createEvents.length === 0) return;
    try {
      await createMutation.mutateAsync({
        name: createName.trim(),
        url: createUrl.trim(),
        events: createEvents,
        ...(createProjectId ? { projectId: createProjectId } : {}),
      });
    } catch {
      // error state handled by mutation
    }
  }

  function handleOpenEdit(wh: WebhookRow) {
    setEditName(wh.name);
    setEditUrl(wh.url);
    setEditEvents(parseEvents(wh.events));
    setEditActive(wh.active);
    setEditProjectId(wh.projectId);
    setRegeneratedSecret(null);
    updateMutation.reset();
    setEditDialogOpen(true);
  }

  function handleCloseEdit() {
    setEditDialogOpen(false);
    setRegeneratedSecret(null);
  }

  async function handleUpdate(e: SyntheticEvent) {
    e.preventDefault();
    if (!selectedWebhookId || !editName.trim() || !editUrl.trim() || editEvents.length === 0) return;
    try {
      await updateMutation.mutateAsync({
        id: selectedWebhookId,
        name: editName.trim(),
        url: editUrl.trim(),
        events: editEvents,
        active: editActive,
        projectId: editProjectId,
      });
    } catch {
      // error state handled by mutation
    }
  }

  async function handleRegenerateSecret() {
    if (!selectedWebhookId) return;
    try {
      await updateMutation.mutateAsync({
        id: selectedWebhookId,
        regenerateSecret: true,
      });
    } catch {
      // error state handled by mutation
    }
  }

  function handleTest(id: string) {
    setTestingId(id);
    setTestResult(null);
    testMutation.mutate(id, {
      onSettled: () => setTestingId(null),
    });
  }

  // ==================================================================
  //  Render — Detail View
  // ==================================================================

  if (selectedWebhookId) {
    const wh = detailWebhook;

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
            onClick={() => {
              setSelectedWebhookId(null);
              setTestResult(null);
            }}
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
            name={editName}
            onNameChange={setEditName}
            url={editUrl}
            onUrlChange={setEditUrl}
            events={editEvents}
            onEventsChange={setEditEvents}
            active={editActive}
            onActiveChange={setEditActive}
            projectId={editProjectId}
            onProjectIdChange={setEditProjectId}
            projects={activeProjects}
            regeneratedSecret={regeneratedSecret}
            onCopiedSecret={() => toast("Secret copied to clipboard")}
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

  // ==================================================================
  //  Render — List View
  // ==================================================================

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
            {(listError).message || "Failed to load webhooks."}
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
                  onClick={() => setSelectedWebhookId(wh.id)}
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
          name={createName}
          onNameChange={setCreateName}
          url={createUrl}
          onUrlChange={setCreateUrl}
          events={createEvents}
          onEventsChange={setCreateEvents}
          projectId={createProjectId}
          onProjectIdChange={setCreateProjectId}
          projects={activeProjects}
          newSecret={newSecret}
          onCopiedSecret={() => toast("Secret copied to clipboard")}
          isPending={createMutation.isPending}
          errorMessage={createMutation.error?.message}
          onSubmit={(e) => void handleCreate(e)}
        />
      )}
    </Container>
  );
}

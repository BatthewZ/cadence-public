import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type SyntheticEvent, useCallback, useState } from "react";

import { type CreateWebhookInput, createWebhookSchema, type UpdateWebhookInput } from "@/shared/schemas/webhook";
import type { WebhookEventType } from "@/shared/types/webhook";
import { useToast } from "@/web/components/ui/ToastContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useFieldErrors } from "@/web/hooks/use-field-errors";
import { useWorkspacePermissions } from "@/web/hooks/use-permissions";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import type { TestDeliveryResult } from "@/web/pages/WorkspaceSettings/components/TestResultDisplay";
import type { DeliveryRow } from "@/web/pages/WorkspaceSettings/components/WebhookColumns";

/* ------------------------------------------------------------------ */
/*  Types (matching API response shapes)                               */
/* ------------------------------------------------------------------ */

export interface WebhookRow {
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
export function projectName(
  projects: Array<{ id: string; name: string }>,
  projectId: string | null,
): string | null {
  if (!projectId) return null;
  return projects.find((p) => p.id === projectId)?.name ?? null;
}

export function parseEvents(raw: string): WebhookEventType[] {
  try {
    return JSON.parse(raw) as WebhookEventType[];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  useWebhookForm — collapses duplicate create/edit form state        */
/* ------------------------------------------------------------------ */

function useWebhookForm() {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEventType[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);

  const reset = useCallback((values?: {
    name?: string;
    url?: string;
    events?: WebhookEventType[];
    projectId?: string | null;
    active?: boolean;
  }) => {
    setName(values?.name ?? "");
    setUrl(values?.url ?? "");
    setEvents(values?.events ?? []);
    setProjectId(values?.projectId ?? null);
    setActive(values?.active ?? true);
    setSecret(null);
  }, []);

  return {
    name, setName,
    url, setUrl,
    events, setEvents,
    projectId, setProjectId,
    active, setActive,
    secret, setSecret,
    reset,
  };
}

/* ------------------------------------------------------------------ */
/*  useWorkspaceWebhooks                                               */
/*                                                                     */
/*  Centralises all state, queries, mutations, and handler functions    */
/*  for the workspace webhooks settings page. View components receive   */
/*  slices of this return value as props, keeping them stateless.       */
/* ------------------------------------------------------------------ */

export function useWorkspaceWebhooks() {
  const { workspace, projects } = useWorkspace();
  const { toast } = useToast();
  const { canManageWorkspace } = useWorkspacePermissions();
  const qc = useQueryClient();
  const workspaceId = workspace?.id ?? "";

  // Only show active projects in webhook selectors -- archived/completed
  // projects shouldn't receive new webhooks.
  const activeProjects = projects.filter((p) => p.status === "active");

  // ---- View state ---------------------------------------------------
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRow | null>(null);

  // ---- Form state (create & edit) -----------------------------------
  const createForm = useWebhookForm();
  const editForm = useWebhookForm();
  const createFieldErrors = useFieldErrors();
  const editFieldErrors = useFieldErrors();

  // ---- Test state ---------------------------------------------------
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
        createForm.setSecret(result.webhook.secret);
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
        editForm.setSecret(result.webhook.secret);
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

  const handleOpenCreate = useCallback(() => {
    createForm.reset();
    createMutation.reset();
    createFieldErrors.resetFieldErrors();
    setCreateDialogOpen(true);
  }, [createForm, createMutation, createFieldErrors]);

  const handleCloseCreate = useCallback(() => {
    setCreateDialogOpen(false);
    createForm.setSecret(null);
  }, [createForm]);

  const handleCreate = useCallback(async (e: SyntheticEvent) => {
    e.preventDefault();
    const input = {
      name: createForm.name.trim(),
      url: createForm.url.trim(),
      events: createForm.events,
      ...(createForm.projectId ? { projectId: createForm.projectId } : {}),
    };
    const result = createWebhookSchema.safeParse(input);
    if (!result.success) {
      createFieldErrors.setFromZodError(result.error);
      return;
    }
    try {
      await createMutation.mutateAsync(result.data);
    } catch {
      // error state handled by mutation
    }
  }, [createForm.name, createForm.url, createForm.events, createForm.projectId, createMutation, createFieldErrors]);

  const handleOpenEdit = useCallback((wh: WebhookRow) => {
    editForm.reset({
      name: wh.name,
      url: wh.url,
      events: parseEvents(wh.events),
      active: wh.active,
      projectId: wh.projectId,
    });
    updateMutation.reset();
    editFieldErrors.resetFieldErrors();
    setEditDialogOpen(true);
  }, [editForm, updateMutation, editFieldErrors]);

  const handleCloseEdit = useCallback(() => {
    setEditDialogOpen(false);
    editForm.setSecret(null);
  }, [editForm]);

  const handleUpdate = useCallback(async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!selectedWebhookId) return;
    const input = {
      name: editForm.name.trim(),
      url: editForm.url.trim(),
      events: editForm.events,
      ...(editForm.projectId ? { projectId: editForm.projectId } : {}),
    };
    const result = createWebhookSchema.safeParse(input);
    if (!result.success) {
      editFieldErrors.setFromZodError(result.error);
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: selectedWebhookId,
        ...result.data,
        active: editForm.active,
      });
    } catch {
      // error state handled by mutation
    }
  }, [selectedWebhookId, editForm.name, editForm.url, editForm.events, editForm.active, editForm.projectId, updateMutation, editFieldErrors]);

  const handleRegenerateSecret = useCallback(async () => {
    if (!selectedWebhookId) return;
    try {
      await updateMutation.mutateAsync({
        id: selectedWebhookId,
        regenerateSecret: true,
      });
    } catch {
      // error state handled by mutation
    }
  }, [selectedWebhookId, updateMutation]);

  const handleTest = useCallback((id: string) => {
    setTestingId(id);
    setTestResult(null);
    testMutation.mutate(id, {
      onSettled: () => setTestingId(null),
    });
  }, [testMutation]);

  const handleSelectWebhook = useCallback((id: string | null) => {
    setSelectedWebhookId(id);
    if (id === null) {
      setTestResult(null);
    }
  }, []);

  const handleCopiedSecret = useCallback(() => {
    toast("Secret copied to clipboard");
  }, [toast]);

  return {
    // Context
    workspace,
    projects,
    activeProjects,
    canManageWorkspace,

    // View state
    selectedWebhookId,
    handleSelectWebhook,
    createDialogOpen,
    editDialogOpen,
    deleteTarget,
    setDeleteTarget,

    // Form state
    createForm,
    editForm,
    createFieldErrors,
    editFieldErrors,

    // Test state
    testResult,
    testingId,

    // Queries
    webhooks,
    listLoading,
    listError,
    detailWebhook,
    deliveries,
    detailLoading,

    // Mutations
    createMutation,
    updateMutation,
    deleteMutation,

    // Handlers
    handleOpenCreate,
    handleCloseCreate,
    handleCreate,
    handleOpenEdit,
    handleCloseEdit,
    handleUpdate,
    handleRegenerateSecret,
    handleTest,
    handleCopiedSecret,
  };
}

export type UseWorkspaceWebhooksReturn = ReturnType<typeof useWorkspaceWebhooks>;

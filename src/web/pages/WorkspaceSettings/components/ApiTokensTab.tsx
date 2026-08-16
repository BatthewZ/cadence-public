import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound } from "lucide-react";
import { useState } from "react";

import { Toggle } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import {
  Alert,
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateIcon,
  EmptyStateTitle,
  Spinner,
  Text,
} from "@/web/components/ui";
import { QueryErrorRetry } from "@/web/components/ui/QueryErrorRetry";
import { useToast } from "@/web/components/ui/ToastContext";
import { useWorkspacePermissions } from "@/web/hooks/use-permissions";
import { useWorkspaceProjects } from "@/web/hooks/use-workspace-projects";
import { api } from "@/web/lib/api/client";

import { AdminOnlyNotice } from "./AdminOnlyNotice";
import { ApiTokenList } from "./api-tokens/ApiTokenList";
import {
  CreateApiTokenDialog,
  type CreateApiTokenInput,
} from "./api-tokens/CreateApiTokenDialog";
import { RevokeTokenConfirmation } from "./api-tokens/RevokeTokenConfirmation";
import { RotateTokenDialog } from "./api-tokens/RotateTokenDialog";
import {
  type ApiTokenCreatedResponse,
  type ApiTokenRow,
  type ListApiTokensResponse,
} from "./api-tokens/types";

/* ------------------------------------------------------------------ */
/*  ApiTokensTab                                                       */
/*                                                                     */
/*  Top-level orchestrator for the workspace's API tokens settings.    */
/*  Owns the React Query data layer, list/dialog state, and routes     */
/*  mutation results into the one-time reveal panel.                   */
/*                                                                     */
/*  Mirrors the WebhooksTab pattern (same React Query shape, same      */
/*  Dialog/Alert/EmptyState primitives) so visual rhythm matches the   */
/*  rest of the settings surface.                                      */
/*                                                                     */
/*  Direct imports for ui/ primitives (QueryErrorRetry) — see the      */
/*  Barrel Import Rule in CLAUDE.md.                                   */
/* ------------------------------------------------------------------ */

/**
 * Query keys for the API tokens tab.
 *
 * The list key encodes `includeRevoked` because the backend filter changes
 * the response shape — toggling the "Show revoked" checkbox must trigger a
 * refetch rather than reuse a stale cached entry that omitted revoked rows.
 * Caching both states independently is intentional: users typically flip the
 * toggle, glance, and flip back, so keeping both responses hot avoids a
 * round-trip on every toggle.
 */
const apiTokenKeys = {
  list: (workspaceId: string, includeRevoked: boolean) =>
    ["workspaces", workspaceId, "api-tokens", { includeRevoked }] as const,
};

interface ApiTokensTabProps {
  workspaceId: string;
}

export function ApiTokensTab({ workspaceId }: ApiTokensTabProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  // Mirrors `tokenIssuanceMiddleware` on the API: minting and rotating are
  // owner/admin-only, while listing and revoking stay open so a member can
  // still audit and retire tokens they already hold.
  const { canManageWorkspace, isResolved } = useWorkspacePermissions();
  // Controls gate on `canManageWorkspace` alone (fail closed); copy that tells
  // the caller they may not mint has to wait for the role, or an admin whose
  // roster is still in flight reads an accusation we then retract.
  const issuanceDenied = isResolved && !canManageWorkspace;

  /* ------- Dialog state -------------------------------------------- */
  const [createOpen, setCreateOpen] = useState(false);
  const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ApiTokenRow | null>(null);
  const [rotatedPlaintext, setRotatedPlaintext] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiTokenRow | null>(null);

  /* ------- Filter state -------------------------------------------- */
  // Default off — the API contract hides revoked tokens unless explicitly
  // requested, and the UI mirrors that so the common case (managing live
  // tokens) is not cluttered by historical tombstones. We keep this in
  // component state rather than URL state because the toggle is a per-
  // session UX preference, not a deep-linkable view.
  const [showRevoked, setShowRevoked] = useState(false);

  /* ------- Queries ------------------------------------------------- */
  const tokensQuery = useQuery({
    queryKey: apiTokenKeys.list(workspaceId, showRevoked),
    queryFn: () =>
      api.get<ListApiTokensResponse>(
        // Only attach the query param when we want revoked rows — sending
        // `?includeRevoked=false` works (enum accepts it) but a clean URL
        // is easier to read in dev tools and matches the API's default
        // semantics.
        showRevoked
          ? `/api/workspaces/${workspaceId}/api-tokens?includeRevoked=true`
          : `/api/workspaces/${workspaceId}/api-tokens`,
      ),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  const projectsQuery = useWorkspaceProjects(workspaceId, {
    // Eagerly load projects so the create dialog's project picker has data
    // ready by the time the user selects "Selected projects".
    enabled: !!workspaceId,
  });

  /* ------- Mutations ----------------------------------------------- */
  /**
   * Single helper invalidates every cached variant of the list (currently
   * `showRevoked: true` and `showRevoked: false`). Passing the workspace
   * prefix without the `{ includeRevoked }` segment relies on React Query's
   * partial-match semantics so we never have to enumerate the variants
   * here — adding a new filter dimension later won't require touching every
   * mutation.
   */
  function invalidateTokenList() {
    void qc.invalidateQueries({
      queryKey: ["workspaces", workspaceId, "api-tokens"] as const,
    });
  }

  const createMutation = useMutation({
    mutationFn: (input: CreateApiTokenInput) =>
      api.post<ApiTokenCreatedResponse>(
        `/api/workspaces/${workspaceId}/api-tokens`,
        input,
      ),
    onSuccess: (result) => {
      invalidateTokenList();
      setCreatedPlaintext(result.token.plaintext);
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (tokenId: string) =>
      api.post<ApiTokenCreatedResponse>(
        `/api/workspaces/${workspaceId}/api-tokens/${tokenId}/rotate`,
        {},
      ),
    onSuccess: (result) => {
      invalidateTokenList();
      setRotatedPlaintext(result.token.plaintext);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (tokenId: string) =>
      api.delete(`/api/workspaces/${workspaceId}/api-tokens/${tokenId}`),
    onSuccess: () => {
      invalidateTokenList();
      toast("API token revoked.", { variant: "success" });
      setRevokeTarget(null);
    },
    onError: () => {
      toast("Failed to revoke token.", { variant: "error" });
    },
  });

  /* ------- Handlers ----------------------------------------------- */
  function handleOpenCreate() {
    createMutation.reset();
    setCreatedPlaintext(null);
    setCreateOpen(true);
  }

  function handleCloseCreate() {
    if (createMutation.isPending) return;
    setCreateOpen(false);
    setCreatedPlaintext(null);
    createMutation.reset();
  }

  async function handleCreate(input: CreateApiTokenInput) {
    await createMutation.mutateAsync(input);
  }

  function handleCreateRevealDismissed() {
    setCreateOpen(false);
    setCreatedPlaintext(null);
    createMutation.reset();
    toast("API token created.", { variant: "success" });
  }

  function handleOpenRotate(token: ApiTokenRow) {
    rotateMutation.reset();
    setRotatedPlaintext(null);
    setRotateTarget(token);
  }

  function handleCloseRotate() {
    if (rotateMutation.isPending) return;
    setRotateTarget(null);
    setRotatedPlaintext(null);
    rotateMutation.reset();
  }

  async function handleConfirmRotate() {
    if (!rotateTarget) return;
    await rotateMutation.mutateAsync(rotateTarget.id);
  }

  function handleRotateRevealDismissed() {
    setRotateTarget(null);
    setRotatedPlaintext(null);
    rotateMutation.reset();
    toast("Token rotated. Update your integrations within 7 days.", {
      variant: "success",
    });
  }

  function handleOpenRevoke(token: ApiTokenRow) {
    revokeMutation.reset();
    setRevokeTarget(token);
  }

  function handleCloseRevoke() {
    if (revokeMutation.isPending) return;
    setRevokeTarget(null);
  }

  function handleConfirmRevoke() {
    if (!revokeTarget) return;
    revokeMutation.mutate(revokeTarget.id);
  }

  /* ------- Render ------------------------------------------------- */
  const tokens = tokensQuery.data?.tokens ?? [];
  const projects = projectsQuery.data?.projects ?? [];
  const showEmpty = !tokensQuery.isLoading && !tokensQuery.error && tokens.length === 0;
  // The toggle is meaningful even when no active tokens exist (a workspace
  // with only revoked tokens still has history to inspect), so it lives
  // outside the `showEmpty` branch. We keep it adjacent to "New Token" so
  // the entire list-control row reads as one cluster.
  const showRevokedToggleId = "api-tokens-show-revoked";

  return (
    <>
      <Stack gap="r4">
        {/* Heading + description — full-width header block. Kept separate
            from the action bar below so the toggle and button align to the
            edges of the content column rather than wrapping under the
            heading on narrow viewports. */}
        <Stack gap="r6" className="min-w-0">
          <Text variant="h5" weight="semibold">
            API Tokens
          </Text>
          <Text variant="body-2" color="secondary">
            Personal Access Tokens for integrating Cadence with Slack bots,
            GitHub Actions, and other tools.{" "}
            <a
              href="/api/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-r6 text-accent hover:underline"
            >
              View API docs
              <ExternalLink size={12} />
            </a>
          </Text>
        </Stack>

        <AdminOnlyNotice>
          Only workspace owners and admins can create or rotate API tokens. Ask a
          workspace admin if you need a token for an integration.
        </AdminOnlyNotice>

        {/* Action bar: "New Token" pinned to the far left, "Show revoked"
            pinned to the far right. `ml-auto` on the toggle label keeps it
            anchored right even when "New Token" is suppressed in the empty
            state — otherwise a single child under `justify-between` would
            jump to the left and the toggle's position would feel unstable
            between renders. */}
        <Row align="center" className="flex-wrap gap-r4">
          {!showEmpty && canManageWorkspace && (
            <Button variant="primary" size="md" onClick={handleOpenCreate}>
              <KeyRound size={16} className="mr-r6" />
              New Token
            </Button>
          )}
          <label
            htmlFor={showRevokedToggleId}
            className="ml-auto inline-flex items-center gap-r6 cursor-pointer select-none"
          >
            <Text variant="body-2" color="secondary">
              Show revoked
            </Text>
            <Toggle
              id={showRevokedToggleId}
              checked={showRevoked}
              onCheckedChange={setShowRevoked}
              aria-label="Show revoked tokens"
            />
          </label>
        </Row>

        {tokensQuery.error && (
          <QueryErrorRetry
            message={tokensQuery.error.message || "Failed to load API tokens."}
            onRetry={() => tokensQuery.refetch()}
          />
        )}

        {tokensQuery.isLoading ? (
          <Row justify="center" className="py-r1">
            <Spinner size="lg" />
          </Row>
        ) : showEmpty ? (
          <EmptyState size="md">
            <EmptyStateIcon>
              <KeyRound size={32} />
            </EmptyStateIcon>
            <EmptyStateTitle>No API tokens yet</EmptyStateTitle>
            <EmptyStateDescription>
              {issuanceDenied
                ? "A workspace owner or admin can issue a token to integrate Cadence with Slack, GitHub Actions, or your own tools."
                : "Generate a token to integrate Cadence with Slack, GitHub Actions, or your own tools."}
            </EmptyStateDescription>
            {canManageWorkspace && (
              <EmptyStateActions>
                <Button variant="primary" size="md" onClick={handleOpenCreate}>
                  <KeyRound size={16} className="mr-r6" />
                  New Token
                </Button>
              </EmptyStateActions>
            )}
          </EmptyState>
        ) : (
          <ApiTokenList
            tokens={tokens}
            projects={projects}
            canRotate={canManageWorkspace}
            onRotate={handleOpenRotate}
            onRevoke={handleOpenRevoke}
          />
        )}

        {revokeMutation.error && (
          <Alert variant="error">
            {revokeMutation.error.message || "Failed to revoke token."}
          </Alert>
        )}
      </Stack>

      {canManageWorkspace && (
        <>
          <CreateApiTokenDialog
            open={createOpen}
            onClose={handleCloseCreate}
            onSubmit={handleCreate}
            isPending={createMutation.isPending}
            errorMessage={createMutation.error?.message}
            plaintext={createdPlaintext}
            projects={projects}
            projectsLoading={projectsQuery.isLoading}
            onRevealDismissed={handleCreateRevealDismissed}
          />

          <RotateTokenDialog
            open={rotateTarget !== null}
            tokenName={rotateTarget?.name}
            onClose={handleCloseRotate}
            onConfirm={handleConfirmRotate}
            isPending={rotateMutation.isPending}
            errorMessage={rotateMutation.error?.message}
            plaintext={rotatedPlaintext}
            onRevealDismissed={handleRotateRevealDismissed}
          />
        </>
      )}

      <RevokeTokenConfirmation
        open={revokeTarget !== null}
        tokenName={revokeTarget?.name}
        onClose={handleCloseRevoke}
        onConfirm={handleConfirmRevoke}
        isPending={revokeMutation.isPending}
      />
    </>
  );
}

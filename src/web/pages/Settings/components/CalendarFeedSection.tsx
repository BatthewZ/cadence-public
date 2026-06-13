import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ClipboardCopy } from "lucide-react";
import { useState } from "react";

import { Row, Stack } from "@/web/components/layout";
import { Alert, Badge, Button, Card, Skeleton, Text } from "@/web/components/ui";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { QueryErrorRetry } from "@/web/components/ui/QueryErrorRetry";
import { useToast } from "@/web/components/ui/ToastContext";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { formatRelativeTime } from "@/web/util/activity";

/* ------------------------------------------------------------------ */
/*  CalendarFeedSection                                                */
/*                                                                     */
/*  Account-settings section for the per-user workspace calendar feed  */
/*  (iCalendar subscription of the user's assigned tasks).             */
/*                                                                     */
/*  Security posture — this matters, do not weaken it:                 */
/*  - The feed URL is a *capability URL*: possession alone grants read */
/*    access to the user's assigned task titles and dates, with no     */
/*    further auth. The server therefore returns it exactly once, from */
/*    the POST that mints it.                                          */
/*  - The plaintext URL is held in component state only. It is never   */
/*    written into the React Query cache (the status query holds bare  */
/*    `{ exists, createdAt, lastUsedAt }` metadata), and the mutation  */
/*    that produced it is `.reset()` on dismissal so the response does */
/*    not linger in the mutation cache either. After "Done", the URL   */
/*    exists nowhere in the client.                                    */
/*  - Regenerating mints a new URL and kills the old one instantly;    */
/*    revoking kills it with no replacement. Both are destructive to   */
/*    existing calendar subscriptions, so both are gated behind        */
/*    ConfirmDialog.                                                   */
/*                                                                     */
/*  The reveal interaction mirrors the PAT RevealTokenPanel            */
/*  (WorkspaceSettings/components/api-tokens) rather than reusing it:  */
/*  that panel hardcodes PAT-specific copy ("Personal Access Token",   */
/*  scope language, a token .txt download) that would be wrong and     */
/*  misleading for a calendar URL. The lower stakes here (losing the   */
/*  URL is fixed by one regenerate click, affecting only your own      */
/*  subscriptions) also mean we skip its acknowledgement checkbox.     */
/* ------------------------------------------------------------------ */

/** Shape of `GET /api/workspaces/:id/calendar-feed` (status metadata only). */
interface CalendarFeedStatus {
  exists: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

interface CalendarFeedSectionProps {
  workspaceId: string;
}

type ConfirmAction = "regenerate" | "revoke";

export function CalendarFeedSection({ workspaceId }: CalendarFeedSectionProps) {
  const qc = useQueryClient();
  const { toast } = useToast();

  /* ------- Reveal-once state --------------------------------------- */
  // The ONLY client-side home for the plaintext URL. Cleared on "Done".
  const [mintedUrl, setMintedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  /* ------- Status query --------------------------------------------- */
  const statusQuery = useQuery({
    queryKey: queryKeys.workspaces.calendarFeed(workspaceId),
    queryFn: () =>
      api.get<CalendarFeedStatus>(`/api/workspaces/${workspaceId}/calendar-feed`),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
  const status = statusQuery.data ?? null;

  /* ------- Mutations ------------------------------------------------ */
  // POST both creates and regenerates: the server replaces any existing
  // feed token, so one mutation serves both flows. Invalidate the status
  // query so the metadata view reflects the new createdAt after dismissal.
  const generateMutation = useMutation({
    mutationFn: () =>
      api.post<{ url: string }>(`/api/workspaces/${workspaceId}/calendar-feed`, {}),
    onSuccess: (result) => {
      setMintedUrl(result.url);
      setCopied(false);
      void qc.invalidateQueries({
        queryKey: queryKeys.workspaces.calendarFeed(workspaceId),
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.delete(`/api/workspaces/${workspaceId}/calendar-feed`),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.workspaces.calendarFeed(workspaceId),
      });
      toast("Calendar feed revoked.", { variant: "success" });
    },
  });

  /* ------- Handlers -------------------------------------------------- */
  function handleGenerate() {
    revokeMutation.reset();
    generateMutation.mutate();
  }

  function openConfirm(action: ConfirmAction) {
    // Clear stale errors so an old failure Alert doesn't outlive its context.
    generateMutation.reset();
    revokeMutation.reset();
    setConfirmAction(action);
  }

  function handleConfirmRegenerate() {
    generateMutation.mutate(undefined, {
      // Close on success AND failure: the reveal panel (success) or the
      // inline error Alert (failure) renders behind the modal, so leaving
      // the dialog open would hide the very feedback the user needs.
      onSettled: () => setConfirmAction(null),
    });
  }

  function handleConfirmRevoke() {
    revokeMutation.mutate(undefined, {
      onSettled: () => setConfirmAction(null),
    });
  }

  /**
   * Dismiss the reveal panel. Resetting the mutation is part of the
   * reveal-once contract: `mutation.data` retains the POST response until
   * reset, and purging it here guarantees the plaintext URL has exactly one
   * owner (this component's state) and zero owners after dismissal.
   */
  function handleRevealDone() {
    setMintedUrl(null);
    setCopied(false);
    generateMutation.reset();
  }

  async function handleCopy() {
    if (!mintedUrl) return;
    try {
      await navigator.clipboard.writeText(mintedUrl);
      setCopied(true);
      // Reset the "Copied!" indicator so a second copy gives visible feedback.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-secure contexts or when permission is
      // denied; the URL stays select-all-able for manual copying.
      setCopied(false);
    }
  }

  function handleCloseConfirm() {
    if (generateMutation.isPending || revokeMutation.isPending) return;
    setConfirmAction(null);
  }

  /* ------- Render ----------------------------------------------------- */
  const mutationError = generateMutation.error ?? revokeMutation.error;

  return (
    <>
      <Card>
        <Stack gap="r4">
          <Row gap="r5" className="items-center">
            <Text variant="h5">Calendar Feed</Text>
            {status?.exists && !mintedUrl && <Badge variant="success">Active</Badge>}
          </Row>

          <Text variant="body-2" color="secondary">
            Subscribe in Google Calendar, Apple Calendar, or Outlook. Anyone
            with this URL can see your assigned task titles and dates.
          </Text>

          {mutationError && (
            <Alert variant="error">
              {mutationError.message || "Something went wrong. Please try again."}
            </Alert>
          )}

          {mintedUrl !== null ? (
            <Stack gap="r4">
              <Alert variant="warning">
                <Row gap="r5" align="start" className="w-full">
                  <AlertTriangle
                    size={18}
                    className="shrink-0 mt-r6 text-status-warning"
                  />
                  <Stack gap="r6">
                    <Text variant="body-2" weight="semibold" as="span">
                      You won&apos;t see this URL again.
                    </Text>
                    <Text variant="body-3" color="muted" as="span">
                      Copy it now and paste it into your calendar app&apos;s
                      &quot;subscribe by URL&quot; option. If you lose it,
                      regenerate a new one — the old URL stops working
                      immediately.
                    </Text>
                  </Stack>
                </Row>
              </Alert>

              <div className="bg-surface-2 rounded-md border border-border-default/60 p-r4">
                <Stack gap="r5">
                  <Text
                    variant="body-3"
                    color="muted"
                    as="span"
                    className="uppercase tracking-wide"
                  >
                    Calendar feed URL
                  </Text>
                  <code
                    className="font-mono text-body-2 break-all select-all leading-relaxed"
                    data-testid="calendar-feed-url"
                  >
                    {mintedUrl}
                  </code>
                  <Row gap="r5" className="flex-wrap">
                    <Button
                      type="button"
                      variant={copied ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => void handleCopy()}
                      aria-label="Copy calendar URL to clipboard"
                    >
                      {copied ? (
                        <>
                          <Check size={14} className="mr-r6" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <ClipboardCopy size={14} className="mr-r6" />
                          Copy
                        </>
                      )}
                    </Button>
                  </Row>
                </Stack>
              </div>

              <Row justify="end" gap="r4">
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleRevealDone}
                >
                  Done
                </Button>
              </Row>
            </Stack>
          ) : statusQuery.isLoading ? (
            <Row className="items-center rounded-md border border-border-default px-r4 py-r4">
              <Stack gap="r6" className="min-w-0 flex-1">
                <Skeleton variant="text" width="14ch" />
                <Skeleton variant="text" width="20ch" height="0.75em" />
              </Stack>
            </Row>
          ) : statusQuery.error ? (
            <QueryErrorRetry
              message={statusQuery.error.message || "Failed to load calendar feed."}
              onRetry={() => statusQuery.refetch()}
            />
          ) : status?.exists ? (
            <Row className="items-center rounded-md border border-border-default px-r4 py-r4">
              <Stack gap="r6" className="min-w-0 flex-1">
                <Text variant="body-2" className="font-medium">
                  iCalendar feed
                </Text>
                <Row gap="r4" className="flex-wrap">
                  {status.createdAt && (
                    <Text variant="body-3" color="secondary">
                      Created {formatRelativeTime(status.createdAt)}
                    </Text>
                  )}
                  <Text variant="body-3" color="secondary">
                    {status.lastUsedAt
                      ? `Last fetched ${formatRelativeTime(status.lastUsedAt)}`
                      : "Never fetched"}
                  </Text>
                </Row>
              </Stack>
              <Row gap="r5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openConfirm("regenerate")}
                  disabled={generateMutation.isPending}
                >
                  Regenerate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openConfirm("revoke")}
                  disabled={revokeMutation.isPending}
                >
                  Revoke
                </Button>
              </Row>
            </Row>
          ) : (
            <Stack gap="r4">
              <Text variant="body-2" color="secondary">
                No calendar URL yet. Generate one to see the tasks assigned to
                you in this workspace inside your calendar app.
              </Text>
              <div>
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleGenerate}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending
                    ? "Generating..."
                    : "Generate calendar URL"}
                </Button>
              </div>
            </Stack>
          )}
        </Stack>
      </Card>

      {/* Conditionally mounted (not just `open`-toggled) so jsdom tests and
          screen readers never see two competing dialog bodies at once. */}
      {confirmAction === "regenerate" && (
        <ConfirmDialog
          open
          onClose={handleCloseConfirm}
          onConfirm={handleConfirmRegenerate}
          title="Regenerate Calendar URL"
          confirmLabel="Regenerate URL"
          confirmingLabel="Regenerating..."
          confirming={generateMutation.isPending}
        >
          This creates a new calendar URL and immediately disables the current
          one. Calendar apps subscribed with the old URL will stop updating
          until you paste in the new one.
        </ConfirmDialog>
      )}

      {confirmAction === "revoke" && (
        <ConfirmDialog
          open
          onClose={handleCloseConfirm}
          onConfirm={handleConfirmRevoke}
          title="Revoke Calendar Feed"
          confirmLabel="Revoke Feed"
          confirmingLabel="Revoking..."
          confirming={revokeMutation.isPending}
        >
          Calendar apps subscribed with this URL will stop updating
          immediately. You can generate a new URL at any time.
        </ConfirmDialog>
      )}
    </>
  );
}

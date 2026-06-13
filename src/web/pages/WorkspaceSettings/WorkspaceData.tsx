/**
 * Workspace Settings → Data tab: one page, two cards, no wizard.
 *
 * ## Export card
 *
 * The download is a plain anchor to `GET /api/workspaces/:id/export` — the
 * server streams the JSON with a `Content-Disposition: attachment` header,
 * so the browser handles the (potentially large) download natively. Going
 * through `fetch` + Blob would buffer the whole document in JS memory for
 * zero benefit. The "Include activity history" checkbox only rewrites the
 * anchor's `?includeActivity=true` query — activity routinely outnumbers
 * tasks 10–20×, so it is opt-in to keep the default export small.
 *
 * The attachments note is an HONEST cut, not boilerplate: attachment
 * binaries are referenced by authenticated URL in the export manifest and
 * are NOT bundled (bundling N×10 MB files through a 128 MB Worker isolate
 * is infeasible without job infrastructure). Users must download them while
 * the workspace is still accessible — the UI says so out loud.
 *
 * ## Import card — upload → preview → confirm → report
 *
 * The dry-run endpoint is STATELESS by design: nothing is persisted between
 * preview and commit, so the confirm step re-POSTs the very same `File`
 * object held in component state. That is why the selected file lives in
 * `useState` and why the preview response also lives in component state
 * rather than the React Query cache — both are meaningless without the
 * exact `File` they were computed from, and caching a preview keyed by
 * anything else could show a stale preview for a different file.
 *
 * The client-side size gate mirrors the server's `MAX_IMPORT_FILE_BYTES`
 * check so an oversized file fails instantly with a readable message
 * instead of after a 20 MB upload ends in a 413.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useState } from "react";

import { MAX_IMPORT_FILE_BYTES } from "@/shared/schemas/workspace-export";
import {
  type ImportCounts,
  type ImportPreview,
  type ImportResponse,
  type ImportResult,
  type ImportSkipped,
} from "@/shared/schemas/workspace-import";
import { Checkbox, Label } from "@/web/components/form";
import { Container, Row, Stack } from "@/web/components/layout";
import { Alert, Badge, Button, Card, Text } from "@/web/components/ui";
import { Breadcrumbs } from "@/web/components/ui/Breadcrumbs";
import { FileUpload } from "@/web/components/ui/FileUpload";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useWorkspacePermissions } from "@/web/hooks/use-permissions";
import { api, ApiError } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { formatBytes } from "@/web/util/format";
import { cn } from "@/web/util/style/style";

import { SettingsNav } from "./SettingsNav";

/* ------------------------------------------------------------------ */
/*  Shared display tables                                              */
/* ------------------------------------------------------------------ */

/** Display order + labels for the per-entity counts (preview AND report —
 *  the shared `importCountsSchema` shape is identical on purpose). */
const COUNT_ROWS: ReadonlyArray<readonly [keyof ImportCounts, string]> = [
  ["projects", "Projects"],
  ["taskGroups", "Task groups"],
  ["tasks", "Tasks"],
  ["labels", "Labels"],
  ["subtasks", "Subtasks"],
  ["comments", "Comments"],
];

/** Labels for the honest-cuts ledger; only non-zero rows are rendered. */
const SKIPPED_ROWS: ReadonlyArray<readonly [keyof ImportSkipped, string]> = [
  ["webhooks", "Webhooks"],
  ["teams", "Teams"],
  ["invitations", "Invitations"],
  ["attachments", "Attachments"],
  ["activity", "Activity history"],
  ["closedItems", "Archived (closed) items"],
];

const SOURCE_FORMAT_LABELS = { cadence: "Cadence", trello: "Trello" } as const;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Maps a failed import POST to the message the Alert shows.
 *
 * - 413: the server rejected on size before parsing — translate the bare
 *   status into the same friendly limit message the client-side gate uses.
 * - 400 (and other ApiErrors): the server's own message is the most
 *   specific information available (Zod issues, format-sniff failures) —
 *   surface it verbatim rather than flattening to a generic error.
 */
function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) {
      return `That file is too large to import — the limit is ${formatBytes(MAX_IMPORT_FILE_BYTES)}.`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Import failed. Please try again.";
}

/* ------------------------------------------------------------------ */
/*  Small presentational pieces                                        */
/* ------------------------------------------------------------------ */

/** Bordered, hairline-divided list shell — the shared container for every
 *  summary list on this page (counts, skipped ledger, unmatched people,
 *  failed projects) and the same visual rhythm as the ImportIcsDialog preview
 *  list. `tone="error"` swaps the border for the rolled-back failed-project
 *  list; rows supply their own row layout. */
function BorderedList({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <ul
      className={cn(
        "rounded-md border divide-y divide-border-default/40",
        tone === "error" ? "border-status-error/30" : "border-border-default",
      )}
    >
      {children}
    </ul>
  );
}

/** A label/value row inside a {@link BorderedList} — the counts table and the
 *  skipped-items ledger are both just lists of these. */
function KeyValueRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center justify-between gap-r4 px-r4 py-r5">
      <Text variant="body-2">{label}</Text>
      <Text variant="body-2" weight="semibold">
        {value}
      </Text>
    </li>
  );
}

/** Per-entity counts, reused for both the dry-run preview and the report. */
function CountsTable({ counts }: { counts: ImportCounts }) {
  return (
    <BorderedList>
      {COUNT_ROWS.map(([key, label]) => (
        <KeyValueRow key={key} label={label} value={counts[key]} />
      ))}
    </BorderedList>
  );
}

/**
 * The honest-cuts ledger. Renders nothing when every count is zero — a
 * "Skipped: none" section would just add noise to clean imports.
 */
function SkippedSummary({ skipped }: { skipped: ImportSkipped }) {
  const rows = SKIPPED_ROWS.filter(([key]) => skipped[key] > 0);
  if (rows.length === 0) return null;

  return (
    <Stack gap="r6">
      <Text variant="body-2" weight="semibold">
        Not imported
      </Text>
      <Text variant="body-3" color="muted">
        These items travel in exports for archival value but are never re-created by an
        import: webhooks and invitations carry secrets, activity history can&apos;t be
        honestly replayed, and attachment files don&apos;t round-trip in the manifest.
      </Text>
      <BorderedList>
        {rows.map(([key, label]) => (
          <KeyValueRow key={key} label={label} value={skipped[key]} />
        ))}
      </BorderedList>
    </Stack>
  );
}

function WarningsList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <Alert variant="warning">
      <Stack gap="r6">
        {warnings.map((warning) => (
          <span key={warning}>{warning}</span>
        ))}
      </Stack>
    </Alert>
  );
}

/* ------------------------------------------------------------------ */
/*  Export card                                                        */
/* ------------------------------------------------------------------ */

function ExportCard({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const [includeActivity, setIncludeActivity] = useState(false);

  // Plain anchor target — see module JSDoc for why this is not a fetch.
  const exportHref = `/api/workspaces/${workspaceId}/export${
    includeActivity ? "?includeActivity=true" : ""
  }`;

  return (
    <Card>
      <Stack gap="r4">
        <Text variant="h5">Export</Text>
        <Text variant="body-2" color="secondary">
          Download everything in this workspace — projects, task groups, tasks, subtasks,
          comments and labels — as a single JSON file you can archive or import into
          another workspace later.
        </Text>

        <Row gap="r5" align="center">
          <Checkbox
            id="export-include-activity"
            checked={includeActivity}
            onChange={(e) => setIncludeActivity(e.target.checked)}
            disabled={!canManage}
          />
          <Label htmlFor="export-include-activity">Include activity history</Label>
        </Row>
        <Text variant="body-3" color="muted">
          Activity history is kept for archival value and can grow the file considerably.
          It is never replayed by an import.
        </Text>

        <div>
          {canManage ? (
            <Button as="a" href={exportHref} download>
              Download workspace (JSON)
            </Button>
          ) : (
            <Button type="button" disabled>
              Download workspace (JSON)
            </Button>
          )}
        </div>

        <Alert variant="info">
          Attachments are referenced by URL in the export manifest — their files are not
          bundled into the download. Download any attachments you need while this
          workspace is still accessible.
        </Alert>

        <Text variant="body-3" color="muted">
          Export tasks as CSV from each project&apos;s settings.
        </Text>
      </Stack>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Import card                                                        */
/* ------------------------------------------------------------------ */

function ImportCard({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  /**
   * The selected file MUST stay in state across the whole preview → confirm
   * flow: the dry-run is stateless server-side, so confirming re-uploads
   * this exact File (see module JSDoc).
   */
  const [file, setFile] = useState<File | null>(null);
  /** Client-side gate failures (extension / size) shown inline on the dropzone. */
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Dry-run response — component state, deliberately NOT the query cache. */
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  /** Commit response; once set, the report pane replaces upload + preview. */
  const [result, setResult] = useState<ImportResult | null>(null);

  const queryClient = useQueryClient();

  const postImport = useCallback(
    (toUpload: File, dryRun: boolean) => {
      const body = new FormData();
      body.append("file", toUpload);
      const query = dryRun ? "?dryRun=true" : "";
      return api.post<ImportResponse>(`/api/workspaces/${workspaceId}/import${query}`, body);
    },
    [workspaceId],
  );

  const previewMutation = useMutation({
    mutationFn: (toUpload: File) => postImport(toUpload, true),
    onSuccess: (response) => {
      // Narrow on the shared discriminant rather than trusting the call
      // site: a server that ignored dryRun would otherwise render a
      // commit report inside the preview pane.
      if (response.dryRun) setPreview(response);
    },
  });

  const commitMutation = useMutation({
    mutationFn: (toUpload: File) => postImport(toUpload, false),
    onSuccess: (response) => {
      if (!response.dryRun) {
        setResult(response);
        setPreview(null);
        // A commit creates projects — refresh the sidebar/workspace project
        // list immediately (same invalidation CreateProjectDialog performs)
        // so the imported projects appear without a manual reload.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.workspaces.projects(workspaceId),
        });
      }
    },
  });

  const { reset: resetPreviewMutation } = previewMutation;
  const { reset: resetCommitMutation } = commitMutation;

  /** Single reset path for "Choose another file" / "Import another file" /
   *  new selection — one function so the states can't drift apart. */
  const resetImport = useCallback(() => {
    setFile(null);
    setUploadError(null);
    setPreview(null);
    setResult(null);
    resetPreviewMutation();
    resetCommitMutation();
  }, [resetPreviewMutation, resetCommitMutation]);

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      const selected = files[0];
      if (!selected) return;
      resetImport();

      // Extension OR MIME match: some platforms report an empty `file.type`
      // for .json files, so a MIME-only check would reject valid exports.
      const isJson =
        selected.name.toLowerCase().endsWith(".json") || selected.type === "application/json";
      if (!isJson) {
        setUploadError("That doesn't look like a .json export file.");
        return;
      }
      if (selected.size > MAX_IMPORT_FILE_BYTES) {
        setUploadError(
          `File is too large — the limit is ${formatBytes(MAX_IMPORT_FILE_BYTES)}.`,
        );
        return;
      }

      setFile(selected);
      previewMutation.mutate(selected);
    },
    [resetImport, previewMutation],
  );

  const showReport = result !== null;
  const showPreview = !showReport && preview !== null && file !== null;
  const projectCount = preview?.counts.projects ?? 0;

  return (
    <Card>
      <Stack gap="r4">
        <Text variant="h5">Import</Text>
        <Text variant="body-2" color="secondary">
          Import a Cadence workspace export or a Trello board export (JSON file). Imported
          content is created as new projects in this workspace — nothing existing is
          modified or overwritten.
        </Text>

        {!canManage && (
          <Text variant="body-3" color="muted">
            Importing data requires the owner or admin role in this workspace.
          </Text>
        )}

        {showReport && result !== null && (
          <Stack gap="r4">
            {result.failedProjects.length === 0 ? (
              <Alert variant="success">
                Imported {plural(result.counts.projects, "project")} successfully.
              </Alert>
            ) : (
              <Alert variant="warning">
                Imported {plural(result.counts.projects, "project")};{" "}
                {result.failedProjects.length} failed and{" "}
                {result.failedProjects.length === 1 ? "was" : "were"} rolled back.
              </Alert>
            )}

            <CountsTable counts={result.counts} />

            {result.failedProjects.length > 0 && (
              <Stack gap="r6">
                <Text variant="body-2" weight="semibold">
                  Failed projects
                </Text>
                <BorderedList tone="error">
                  {result.failedProjects.map((failed) => (
                    <li key={failed.name} className="px-r4 py-r5">
                      <Text variant="body-2" weight="semibold">
                        {failed.name}
                      </Text>
                      <Text variant="body-3" color="muted">
                        {failed.error}
                      </Text>
                    </li>
                  ))}
                </BorderedList>
                <Text variant="body-3" color="muted">
                  Failed projects were fully rolled back. Successfully imported projects
                  will be duplicated if you import the same file again.
                </Text>
              </Stack>
            )}

            <SkippedSummary skipped={result.skipped} />
            <WarningsList warnings={result.warnings} />

            <div>
              <Button type="button" variant="secondary" onClick={resetImport}>
                Import another file
              </Button>
            </div>
          </Stack>
        )}

        {showPreview && preview !== null && file !== null && (
          <Stack gap="r4">
            <Row justify="between" align="center" gap="r4">
              <Row gap="r5" align="center" className="min-w-0">
                <Badge variant="info">{SOURCE_FORMAT_LABELS[preview.sourceFormat]}</Badge>
                <Text variant="body-2" color="secondary" className="truncate">
                  Preview of{" "}
                  <span className="font-semibold text-fg-primary">{file.name}</span>
                </Text>
              </Row>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetImport}
                disabled={commitMutation.isPending}
              >
                Choose another file
              </Button>
            </Row>

            <CountsTable counts={preview.counts} />

            {preview.unmatchedUsers.length > 0 && (
              <Stack gap="r6">
                <Text variant="body-2" weight="semibold">
                  Unmatched people
                </Text>
                <Text variant="body-3" color="muted">
                  These people aren&apos;t members of this workspace, so their assignments
                  and authorship will be imported as unassigned. Invite them first if you
                  want their work re-linked.
                </Text>
                <BorderedList>
                  {preview.unmatchedUsers.map((unmatched) => (
                    <li
                      key={unmatched.email}
                      className="flex items-center justify-between gap-r4 px-r4 py-r5 min-w-0"
                    >
                      <Text variant="body-2" className="truncate">
                        {unmatched.name}{" "}
                        <span className="text-fg-muted">({unmatched.email})</span>
                      </Text>
                      <Text variant="body-3" color="muted" className="shrink-0">
                        {plural(unmatched.taskCount, "task")}
                      </Text>
                    </li>
                  ))}
                </BorderedList>
              </Stack>
            )}

            <SkippedSummary skipped={preview.skipped} />
            <WarningsList warnings={preview.warnings} />

            {commitMutation.isError && (
              <Alert variant="error">{importErrorMessage(commitMutation.error)}</Alert>
            )}
          </Stack>
        )}

        {!showReport && !showPreview && (
          <Stack gap="r5">
            <FileUpload
              onFilesSelected={handleFilesSelected}
              disabled={!canManage}
              uploading={previewMutation.isPending}
              error={uploadError}
              hint={`.json export file, up to ${formatBytes(MAX_IMPORT_FILE_BYTES)}`}
            />
            {previewMutation.isError && (
              <Alert variant="error">{importErrorMessage(previewMutation.error)}</Alert>
            )}
          </Stack>
        )}

        {!showReport && (
          <Row justify="end">
            <Button
              type="button"
              onClick={() => {
                if (file !== null) commitMutation.mutate(file);
              }}
              disabled={!canManage || preview === null || commitMutation.isPending}
            >
              {commitMutation.isPending
                ? "Importing…"
                : preview !== null
                  ? `Import ${plural(projectCount, "project")}`
                  : "Import"}
            </Button>
          </Row>
        )}
      </Stack>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  WorkspaceData page                                                 */
/* ------------------------------------------------------------------ */

export default function WorkspaceData() {
  const { workspace } = useWorkspace();
  useDocumentTitle(`${workspace.name} — Data`);
  const { canManageWorkspace } = useWorkspacePermissions();

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
          <Breadcrumbs.Item current>Data</Breadcrumbs.Item>
        </Breadcrumbs>
        <Text variant="h3">Workspace Settings</Text>
        <SettingsNav basePath={`/w/${workspace.slug}/settings`} />

        {!canManageWorkspace && (
          <Alert variant="info">
            Only workspace owners and admins can export or import workspace data. Ask a
            workspace admin if you need a copy of this workspace.
          </Alert>
        )}

        <ExportCard workspaceId={workspace.id} canManage={canManageWorkspace} />
        <ImportCard workspaceId={workspace.id} canManage={canManageWorkspace} />
      </Stack>
    </Container>
  );
}

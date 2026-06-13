/**
 * Import-calendar dialog: pick an `.ics` file, preview what it contains,
 * choose a target task group, and POST the parsed events to the bulk import
 * endpoint.
 *
 * ## Why parsing happens HERE (client-side)
 *
 * The shared `parseICS` is isomorphic, so the raw file never crosses the
 * wire — the server only ever receives structured JSON that `importTasksSchema`
 * validates like any hand-created task. That keeps hostile calendar files out
 * of the Worker entirely and lets the user approve a preview of exactly what
 * will be created before anything is sent.
 *
 * ## Why the 1 MB / 500-task caps live here too
 *
 * The 1 MB gate bounds the memory the browser spends parsing a file that the
 * user may have picked by accident (a real calendar with 500 events is a few
 * hundred KB). The 500-item slice mirrors `importTasksSchema`'s `.max(500)`
 * — sending more would make the endpoint reject the WHOLE batch with a 400,
 * so the client truncates up front and tells the user, which degrades far
 * better than a dead-end error after a long upload.
 *
 * ## Re-import / dedupe caveat (surfaced in the dialog copy)
 *
 * The endpoint dedupes on each event's ICS `UID` (`sourceUid`). Events
 * without a UID can never be recognised on re-import and are deliberately
 * created again — documented endpoint behavior, so the dialog says so rather
 * than letting users discover duplicates the hard way.
 */
import { useCallback, useMemo, useState } from "react";

import { type ParsedEvent, parseICS, type ParseICSResult } from "@/shared/lib/ics-parse";
import type { ImportTaskItem } from "@/shared/schemas/task";
import { FormActions, Label, Select } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import { Alert } from "@/web/components/ui/Alert";
import { Button } from "@/web/components/ui/Button";
import { Dialog } from "@/web/components/ui/Dialog";
import { FileUpload } from "@/web/components/ui/FileUpload";
import { Text } from "@/web/components/ui/Text";
import { useToast } from "@/web/components/ui/ToastContext";
import { useProject } from "@/web/contexts/ProjectContext";
import { api } from "@/web/lib/api/client";
import { sortByPosition } from "@/web/lib/sort-by-position";

/** Client-side file size gate (see module JSDoc). */
export const MAX_IMPORT_FILE_BYTES = 1024 * 1024;

/** Mirror of `importTasksSchema`'s `.max(500)` — see module JSDoc. */
const MAX_IMPORT_TASKS = 500;

/** Preview shows the first N events; the rest are summarized as "+ n more". */
const PREVIEW_ROW_LIMIT = 10;

interface ImportResult {
  created: number;
  skipped: number;
  total: number;
}

/**
 * Maps one parsed VEVENT to an import item.
 *
 * - Single-day events (`startDate === endDate`) send `dueDate` ONLY: in
 *   Cadence's date model `startDate` exists solely to open a range, and the
 *   import schema rejects ranges the create-task schema would reject.
 * - Multi-day events send both bounds (`endDate` is already inclusive — the
 *   parser reversed RFC 5545's exclusive DTEND).
 * - Title/description are truncated to the schema caps (200/5000): one
 *   oversized SUMMARY must not 400 the entire batch.
 * - UIDs longer than the schema's 512-char cap are DROPPED rather than
 *   truncated — a truncated UID could collide with a different event's
 *   prefix and wrongly skip it as a "duplicate"; importing blind (duplicate
 *   on re-import) is the safer failure.
 */
function toImportItem(event: ParsedEvent): ImportTaskItem {
  const item: ImportTaskItem = { title: event.summary.slice(0, 200) };
  if (event.description) {
    item.description = event.description.slice(0, 5000);
  }
  if (event.uid && event.uid.length <= 512) {
    item.sourceUid = event.uid;
  }
  if (event.startDate && event.endDate) {
    if (event.startDate === event.endDate) {
      item.dueDate = event.endDate;
    } else {
      item.startDate = event.startDate;
      item.dueDate = event.endDate;
    }
  }
  return item;
}

/** "Imported 42 tasks (3 duplicates skipped)" — skipped clause only when > 0. */
function importResultMessage(created: number, skipped: number): string {
  const base = `Imported ${created} task${created === 1 ? "" : "s"}`;
  if (skipped === 0) return base;
  return `${base} (${skipped} duplicate${skipped === 1 ? "" : "s"} skipped)`;
}

/**
 * Formats a `"YYYY-MM-DD"` string for the preview. Parsed via `Date.UTC`
 * parts and formatted with an explicit `timeZone: "UTC"` so the displayed
 * day can never drift from the day in the file (`new Date("YYYY-MM-DD")` +
 * local formatting shifts a day for users west of UTC).
 */
function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatEventDates(event: ParsedEvent): string {
  if (!event.startDate || !event.endDate) return "No date";
  if (event.startDate === event.endDate) return formatDay(event.startDate);
  return `${formatDay(event.startDate)} – ${formatDay(event.endDate)}`;
}

interface ImportIcsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ImportIcsDialog({ open, onClose }: ImportIcsDialogProps) {
  const { project, taskGroups, refetchTasks } = useProject();
  const { toast } = useToast();

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseICSResult | null>(null);
  /** Inline FileUpload error: wrong type / oversize / unreadable file. */
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** File parsed cleanly but yielded zero events → dedicated Alert. */
  const [emptyFile, setEmptyFile] = useState(false);
  const [groupChoice, setGroupChoice] = useState("");
  const [importing, setImporting] = useState(false);

  // Same source + ordering as the board's GroupPicker: context task groups
  // sorted by fractional-index position, so "first group" here is the
  // left-most column the user sees.
  const sortedGroups = useMemo(() => sortByPosition(taskGroups), [taskGroups]);
  const selectedGroupId = groupChoice !== "" ? groupChoice : (sortedGroups[0]?.id ?? "");

  const events = parsed?.events ?? [];
  const warnings = parsed?.warnings ?? [];
  const importCount = Math.min(events.length, MAX_IMPORT_TASKS);

  const resetFile = useCallback(() => {
    setFileName(null);
    setParsed(null);
    setUploadError(null);
    setEmptyFile(false);
  }, []);

  const handleDialogClose = useCallback(() => {
    resetFile();
    setGroupChoice("");
    onClose();
  }, [resetFile, onClose]);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    // Clear any prior file/preview/error state before validating the new pick,
    // via the same path `resetFile` uses so the two can't drift apart.
    resetFile();

    // Extension OR MIME match: many platforms report an empty `file.type`
    // for .ics files, so a MIME-only check would silently reject valid files.
    const isIcs =
      file.name.toLowerCase().endsWith(".ics") || file.type === "text/calendar";
    if (!isIcs) {
      setUploadError("That doesn't look like an .ics calendar file.");
      return;
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setUploadError("File is too large — the limit is 1 MB.");
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      setUploadError("Couldn't read the file. Please try again.");
      return;
    }

    const result = parseICS(text);
    if (result.events.length === 0) {
      // Not a dead end: the FileUpload stays mounted so the user can pick
      // another file immediately.
      setEmptyFile(true);
      return;
    }
    setFileName(file.name);
    setParsed(result);
  }, [resetFile]);

  const handleImport = useCallback(async () => {
    if (!parsed || importing || selectedGroupId === "") return;
    setImporting(true);
    try {
      const tasks = parsed.events.slice(0, MAX_IMPORT_TASKS).map(toImportItem);
      const result = await api.post<ImportResult>(
        `/api/projects/${project.id}/tasks/import`,
        { taskGroupId: selectedGroupId, tasks },
      );
      toast(importResultMessage(result.created, result.skipped), { variant: "success" });
      refetchTasks();
      handleDialogClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to import calendar.", {
        variant: "error",
      });
    } finally {
      setImporting(false);
    }
  }, [parsed, importing, selectedGroupId, project.id, toast, refetchTasks, handleDialogClose]);

  return (
    <Dialog open={open} onClose={handleDialogClose}>
      <Stack gap="r4">
        <Stack gap="r6">
          <Text variant="h4">Import calendar</Text>
          <Text variant="body-2" color="secondary">
            Add the events from an .ics calendar file to this project as tasks.
          </Text>
        </Stack>

        {parsed === null ? (
          <Stack gap="r5">
            <FileUpload
              onFilesSelected={(files) => {
                void handleFilesSelected(files);
              }}
              error={uploadError}
              hint=".ics calendar file, up to 1 MB"
            />
            {emptyFile && (
              <Alert variant="warning">
                This file doesn&apos;t contain any readable events. Try exporting
                it again from your calendar app, then pick the new file.
              </Alert>
            )}
          </Stack>
        ) : (
          <Stack gap="r4">
            <Row justify="between" align="center" gap="r4">
              <Text variant="body-2" color="secondary" className="truncate">
                {events.length} event{events.length === 1 ? "" : "s"} found in{" "}
                <span className="font-semibold text-fg-primary">{fileName}</span>
              </Text>
              <Button type="button" variant="ghost" size="sm" onClick={resetFile}>
                Choose another file
              </Button>
            </Row>

            {warnings.length > 0 && (
              <Alert variant="warning">
                {warnings.length} event{warnings.length === 1 ? "" : "s"} couldn&apos;t
                be read and will be left out.
              </Alert>
            )}

            {events.length > MAX_IMPORT_TASKS && (
              <Alert variant="warning">
                Imports are limited to {MAX_IMPORT_TASKS} tasks at a time — only the
                first {MAX_IMPORT_TASKS} events will be imported.
              </Alert>
            )}

            <ul className="max-h-64 overflow-y-auto rounded-md border border-border-default divide-y divide-border-default/40">
              {events.slice(0, PREVIEW_ROW_LIMIT).map((event, i) => (
                <li
                  key={`${event.uid ?? "no-uid"}-${i}`}
                  className="flex items-center justify-between gap-r4 px-r4 py-r5 min-w-0"
                >
                  <Text variant="body-2" className="truncate">
                    {event.summary}
                  </Text>
                  <Text variant="body-3" color="muted" className="shrink-0">
                    {formatEventDates(event)}
                  </Text>
                </li>
              ))}
            </ul>
            {events.length > PREVIEW_ROW_LIMIT && (
              <Text variant="body-3" color="muted">
                + {events.length - PREVIEW_ROW_LIMIT} more event
                {events.length - PREVIEW_ROW_LIMIT === 1 ? "" : "s"}
              </Text>
            )}

            {sortedGroups.length === 0 ? (
              <Alert variant="error">
                This project has no task groups yet — create one before importing.
              </Alert>
            ) : (
              <Stack gap="r6">
                <Label htmlFor="import-ics-group">Add tasks to</Label>
                <Select
                  id="import-ics-group"
                  value={selectedGroupId}
                  onChange={(e) => setGroupChoice(e.target.value)}
                >
                  {sortedGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </Stack>
            )}

            <Text variant="body-3" color="muted">
              Re-importing the same file skips events it has already created,
              matched by each event&apos;s unique ID. Events without an ID are
              always created again.
            </Text>
          </Stack>
        )}

        <FormActions>
          <Button
            type="button"
            variant="ghost"
            onClick={handleDialogClose}
            disabled={importing}
          >
            Cancel
          </Button>
          {parsed !== null && (
            <Button
              type="button"
              onClick={() => {
                void handleImport();
              }}
              disabled={importing || selectedGroupId === ""}
            >
              {importing
                ? "Importing…"
                : `Import ${importCount} task${importCount === 1 ? "" : "s"}`}
            </Button>
          )}
        </FormActions>
      </Stack>
    </Dialog>
  );
}

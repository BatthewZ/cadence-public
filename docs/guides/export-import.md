# Export & Import

Cadence's ethos is that **your data is never held hostage**. This guide covers the three surfaces that make that promise true in-product, the export format itself, and — just as important — an honest account of what does *not* round-trip and why.

| Surface | Where | Who | Limit |
|---|---|---|---|
| Workspace export (JSON) | Workspace Settings → **Data**, or [`GET /api/workspaces/:workspaceId/export`](../api/endpoints.md#get-apiworkspacesworkspaceidexport) | Workspace owner/admin | 5/hour |
| Project export (CSV) | Project Settings → **Export tasks (CSV)**, or [`GET /api/projects/:projectId/export/csv`](../api/endpoints.md#get-apiprojectsprojectidexportcsv) | Any project member | 30/hour |
| Workspace import (Cadence JSON or Trello) | Workspace Settings → **Data**, or [`POST /api/workspaces/:workspaceId/import`](../api/endpoints.md#post-apiworkspacesworkspaceidimport) | Workspace owner/admin | 10/hour, ≤ 20 MB file |

---

## Exporting a workspace (JSON)

**Workspace Settings → Data → download the workspace archive.** The browser downloads a single JSON file named `<slug>-export-<YYYY-MM-DD>.json`. An "include activity history" option adds each task's changelog (`?includeActivity=true` on the API); it is **off by default** because activity routinely outnumbers tasks 10–20× and most exports don't need it.

What you get is one canonical, versioned JSON document containing the workspace metadata, the member/team directory, webhook and invitation configuration (minus secrets — see below), and every project with its task groups, labels, tasks, subtasks, comments, and attachment manifests. The server streams the document one project at a time, so even very large workspaces export in a single request with no job queue, no "we'll email you a link", and no temp storage.

Access control reflects what this is — the most privileged read in the API (full data egress):

- **Owner or admin only**, rate-limited to **5 exports/hour** per caller.
- Reachable with a `workspace:read` [PAT](../api/api-tokens.md), but only when the token's owning user is an owner/admin (scopes are AND-ed with role).
- **A token with `projectScope: "selected"` is refused with `403 Forbidden`**, not served a filtered file. This export is a workspace-wide read by definition — it carries the member and team directory, workspace settings, and webhook and invitation configuration, none of which belongs to any one project — so there is no honest way to narrow it to a project list. A caller that needs data from selected projects should use the per-project CSV export, or a token scoped to all projects. The refusal is returned before any data is read, so it costs nothing on a large workspace.
- Every successful export writes an `audit_log` row (action `export`) — for cookie sessions and PATs alike — so "who pulled a full copy of this workspace, and when" is always answerable after the fact.

---

## The export format

The contract is the Zod schema in [`src/shared/schemas/workspace-export.ts`](../../src/shared/schemas/workspace-export.ts) — there is no second, drifting description of the format. Import validation is literally `workspaceExportSchema.parse(file)`, and the export builder is typed against the same schema, so a new column that isn't added to the contract is a compile/test failure rather than silent data loss in someone's archive. What follows is an orientation, not a replacement for the schema.

```json
{
  "format": "cadence.workspace",
  "formatVersion": 1,
  "exportedAt": "2026-06-12T12:00:00.000Z",
  "exportedBy": "owner@example.com",
  "workspace": { "name": "...", "slug": "...", "description": null, "theme": null },
  "users":       [{ "ref": "<source user id>", "email": "alice@example.com", "name": "Alice" }],
  "members":     [{ "userRef": "...", "role": "owner", "joinedAt": "..." }],
  "teams":       [{ "name": "...", "description": null, "members": [] }],
  "webhooks":    [{ "name": "...", "url": "...", "events": ["task.created"], "active": true, "projectId": null }],
  "invitations": [{ "email": "...", "role": "member", "status": "pending" }],
  "projects": [
    {
      "id": "<source project id>",
      "name": "...", "description": null, "status": "active",
      "icon": null, "coverImage": null, "coverUnsplash": null,
      "theme": null, "budget": null, "autoAssignCreator": false,
      "position": "a0", "createdAt": "...", "updatedAt": "...",
      "members":    [{ "userRef": "...", "role": "admin" }],
      "taskGroups": [{ "id": "...", "name": "To Do", "color": null, "isCompletionGroup": false, "position": "a0", "createdAt": "...", "updatedAt": "..." }],
      "labels":     [{ "id": "...", "name": "backend", "color": "#3b82f6", "createdAt": "..." }],
      "tasks": [
        {
          "id": "...", "taskGroupId": "...", "title": "...",
          "assigneeRef": "...", "priority": "medium",
          "completed": false, "completedAt": null, "completedByRef": null,
          "startDate": null, "dueDate": null, "cost": null,
          "labelIds": ["..."],
          "subtasks": [], "comments": [],
          "attachments": [{ "filename": "spec.pdf", "mimeType": "application/pdf", "size": 12345, "key": "...", "url": "/api/uploads/..." }]
        }
      ]
    }
  ]
}
```

Conventions the format pins, and why:

- **`format` / `formatVersion` are literals** (`"cadence.workspace"`, `1`), not free strings. A file from another tool or a future incompatible version fails the very first parse with an exact, named mismatch instead of confusing downstream field errors.
- **Entity `id`s are opaque *source-instance* ids.** They exist only for intra-file joins (`taskGroupId`, `labelIds`, `recurrenceParentId`, webhook `projectId`). Import never reuses them — every imported entity gets a fresh UUID — and they are deliberately not validated as UUIDs so non-Cadence producers (the Trello converter) can use any unique string.
- **People are `ref`s into the top-level `users` directory, and email is the portable key.** Every `assigneeRef` / `completedByRef` / comment `authorRef` / activity `actorRef` points into `users: [{ ref, email, name }]`. Emails are unique per Cadence instance, which makes them the only honest cross-instance user identity; the `ref` indirection avoids repeating emails on every row. The directory also covers **ex-members** who created or were assigned work, so the archive never loses the answer to "who did this?".
- **All timestamps are ISO 8601 with an explicit timezone.** The exporter emits UTC (`...Z`); offsets are accepted on import. Zone-less timestamps are rejected — they are ambiguous data.
- **Money is integer cents** (`task.cost`, `project.budget`); ordering fields (`position`) are fractional-index strings.
- **Field constraints mirror the app's create/update schemas** (title ≤ 200 chars, comment body ≤ 5000, label name ≤ 30, …). Import is not a back door around validation: an imported task can never carry a value a hand-created one couldn't.

---

## What round-trips — and what doesn't

This is the section to read before relying on export/import for migration or restore. An export→import round trip of the content subtree is enforced by an automated test; everything else is listed here honestly rather than discovered later as silently missing data.

| Data | Exports? | Imports? | Why |
|---|---|---|---|
| Projects, task groups, tasks, subtasks, comments, labels, project members | Yes | **Yes — full round trip** | The core promise, pinned by the export→import→export round-trip test |
| Unsplash cover photos | Yes | Yes | Pure JSON metadata — nothing binary to lose |
| Attachments | **Manifest only** (filename, type, size, key, authenticated `url`) | No — reported as skipped | Binaries are not bundled: streaming N×10 MB blobs through a 128 MB Worker isolate (where every R2 read also costs a subrequest) would require job/temp-storage infrastructure the design deliberately avoids. **Download attachments via the manifest URLs while the source workspace is still accessible.** |
| Uploaded cover images | Manifest only | No — reported as a warning | Same binary constraint as attachments |
| Activity history | **Opt-in** (`?includeActivity=true`) | **Never** | History is your data, so it travels for archival value — but import never replays it, because historical provenance (who did what, when) cannot be honestly recreated on another instance |
| Workspace name/slug/theme, members, teams | Yes | No — reported as skipped | Import is scoped to *content* and targets the current workspace; the file's members section is used only as the email-matching directory, and roles are never applied |
| Webhook configuration | Yes — **minus the signing `secret`** | No — reported as skipped | Secrets never leave the instance. The schema is strict: a document that *does* carry a `secret` key fails to parse rather than being silently accepted |
| Invitations | Email/role/status — **never the acceptance `token`** | No — reported as skipped | The token is a bearer secret; exporting it would let a file holder accept invitations |
| Audit log, webhook deliveries, API tokens, notifications | No | — | Operational/security ledgers and credentials, not workspace content |

**CSV import is deliberately not in v1.** A correct CSV import requires a column-mapping wizard — exactly the bloat the product rejects — while Trello import covers migration and canonical JSON covers round-trip/restore. CSV *export* ships (below); CSV import is a fast follow only if users ask for it.

---

## Exporting a project (CSV)

**Project Settings → Export tasks (CSV)** (or `GET /api/projects/:projectId/export/csv`) downloads a flat spreadsheet of every task in the project, one row per task in board reading order (group position, then task position).

Columns: `title`, `group`, `assignee_email`, `due_date` (`YYYY-MM-DD`), `priority`, `labels` (`;`-joined, name-sorted), `completed` (`true`/`false`), `cost` (fixed-decimal currency units, e.g. `10.50`).

- **Any project member — including viewers — may export.** Viewers can already read every exported field one request at a time through the task API; gating the CSV tighter would be theater, not a control. Rate limit: 30/hour.
- Output is RFC 4180-quoted and hardened against **CSV formula injection** (OWASP): user-controlled cells beginning `=`, `+`, `-`, `@`, tab, or CR are prefixed with `'` so spreadsheets render them as text instead of executing them.
- Reachable with a `project:read` [PAT](../api/api-tokens.md). Unlike the workspace export, this one **is** available to a `projectScope: "selected"` token — for the projects on its list. A project outside the list answers `403 Forbidden`, exactly as every other project-addressed endpoint does for that token.

---

## Importing

**Workspace Settings → Data → upload a file.** The same endpoint ([`POST /api/workspaces/:workspaceId/import`](../api/endpoints.md#post-apiworkspacesworkspaceidimport), owner/admin only, 10/hour, multipart file ≤ 20 MB, `workspace:write` for [PAT](../api/api-tokens.md) callers) accepts two formats, sniffed automatically:

- a **Cadence workspace export** (recognized by its `format: "cadence.workspace"` field), or
- a **Trello board JSON export** (see the next section).

### What import does

- **Creates new projects in the current workspace — never merges.** Existing projects, tasks, and settings are never touched, which makes import collision-free by construction (every imported entity gets a fresh UUID, and a new project is a fresh uniqueness namespace for group names, labels, and positions). Want a fresh workspace? Create one, then import into it. Duplicate project names are allowed — Cadence doesn't require them to be unique.
- **Matches people by email, against current workspace members only.** A file `ref` resolves through the `users` directory to an email (case-insensitively) and then to a *member of the target workspace*. Matching against all platform accounts would leak account existence — an importer could probe "does x@y.com have an account?" — and would attach content to people who never joined the workspace. Unmatched users are not an error: their tasks import **unassigned** and the report lists each unmatched person with how many tasks lose them, so you can decide "invite them first, or import anyway?". The importing user is added as admin of every imported project.
- **Is all-or-nothing per project.** Each project's graph is written in FK-ordered batches; on any mid-project failure the partial graph is fully rolled back (compensating delete) and that project appears in `failedProjects` while the remaining projects still import — "3 of 4 projects imported; 'Roadmap' failed and was fully rolled back."
- **Repairs what it safely can, and says so.** A `recurrenceParentId` pointing at a task not in the file is nulled with a warning; a label reference with no matching label is dropped with a warning. What it *can't* safely repair (a task referencing a nonexistent group, ambiguous duplicate user refs) is a `400` with named errors — never a half-imported project.
- **Reports skipped sections honestly.** Webhooks, teams, invitations, attachments, and activity present in the file are counted into a `skipped` ledger in the preview and result rather than silently dropped (see the round-trip table above for why each is skipped).
- **Is audited on commit** (`audit_log` action `import`).

### Dry-run preview

The Data tab always previews before committing: the file is first posted with `?dryRun=true`, which runs the identical parse → validate → convert → user-match → repair pipeline with **zero writes** and returns the detected format, per-entity counts, unmatched users, skipped sections, and warnings. The preview is **stateless** — the server keeps nothing between requests, so confirming re-uploads the same file. A re-upload of a ≤ 20 MB file is far cheaper than building temp-file storage with cleanup jobs, and statelessness means an abandoned preview can never leak a stale file server-side.

### Errors and limits

- Files over **20 MB** are rejected with `413` *before* parsing. The cap exists because parsing plus building insert rows costs roughly 4–5× the file size in Worker memory; 20 MB still fits ~15–20k tasks — beyond any realistic single import.
- Malformed JSON, unrecognized formats, and documents that fail the schema or integrity checks are `400` with human-readable messages.

---

## Importing from Trello

**Getting the file:** open the Trello board → Board menu → **Print/Export → Export as JSON**. Upload that file to the Data tab like any other import — Trello boards are converted server-side into the same canonical structure, so they get the same preview, commit, and per-project rollback.

### What maps to what

| Trello | Cadence | Notes |
|---|---|---|
| Board | One project | `name`, `desc` → description |
| Lists (open) | Task groups | Ordered by Trello position; archived lists skipped |
| Cards (open) | Tasks | `name`, `desc`, `due` → due date, `dueComplete` → completed; archived cards skipped |
| Labels | Labels | Trello color tokens map to the nearest Cadence palette color; unnamed labels are named after their color; duplicate names get a ` (2)` suffix |
| Checklists / check items | Subtasks | With multiple checklists on a card, item titles are prefixed `"<checklist>: <item>"` to preserve grouping; `state: "complete"` → completed |
| Comment actions (`commentCard`, present in full exports) | Comments | Author folded into the body as `**Name:** …` (see lossiness below) |
| Members | — | All unmatched by design (see below) |

Creation dates are recovered from Trello's ids where possible (they embed a real creation timestamp), so imported items keep honest provenance instead of all being stamped with the import time.

### Known lossiness

- **Everything imports unassigned.** Trello exports contain member names but **no email addresses**, and email is the only user-matching key Cadence accepts — matching by display name would mis-assign work. Comment authorship survives as the `**Name:**` body prefix; assignees do not survive at all. The report says so.
- **Archived ("closed") lists and cards are skipped**, and counted in the report — silently resurrecting data Trello itself hides would be surprising. Cards whose list is missing from the export are skipped and warned about, not silently dropped.
- **Colors are nearest-match.** Trello's palette doesn't map 1:1 onto Cadence's (e.g. Trello *lime* lands on green, *black* lands on gray, `_dark`/`_light` shades collapse to their base hue).
- **Ordering is regenerated** from Trello's position floats; no task group is ever guessed to be the "completed" column (inferring it from a list named "Done" would silently change task semantics).
- **Over-long values are truncated to Cadence's field limits** (e.g. titles to 200 chars), with a tally in the warnings — imports don't bypass the app's validation rules.
- `dueComplete` marks a task completed, but Trello doesn't record *when*, so `completedAt` stays empty.

---

## Limits

| Limit | Value |
|---|---|
| Workspace JSON export rate | 5/hour per caller (owner/admin only) |
| Project CSV export rate | 30/hour per caller (any project member) |
| Import rate | 10/hour per caller (owner/admin only) |
| Max import file size | 20 MB (`413` above it, checked before parse) |
| Attachment binaries in archives | Not included — manifest + authenticated URLs only |
| Very large files | A file with more than ~40 projects can exceed the Cloudflare Workers **Free-plan** subrequest budget in a single request (each imported project costs several D1 batches) — split the file and import in stages, or run on a paid plan |

## See also

- [Endpoints § Workspace export](../api/endpoints.md#get-apiworkspacesworkspaceidexport), [§ Workspace import](../api/endpoints.md#post-apiworkspacesworkspaceidimport), and [§ CSV export](../api/endpoints.md#get-apiprojectsprojectidexportcsv) — full request/response reference
- [`src/shared/schemas/workspace-export.ts`](../../src/shared/schemas/workspace-export.ts) — the format contract (single source of truth)
- [`src/shared/schemas/workspace-import.ts`](../../src/shared/schemas/workspace-import.ts) — preview/result response contracts
- [API Tokens](../api/api-tokens.md) — exporting via PAT, and the audit ledger every export/import lands in

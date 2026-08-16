import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

import type { Database } from "../../../db";
import { user as userTable } from "../../../db/schema/auth";
import { project } from "../../../db/schema/project";
import { task } from "../../../db/schema/task";
import { taskAttachment } from "../../../db/schema/task-attachment";
import { upload } from "../../../db/schema/uploads";
import { ALLOWED_IMAGE_TYPES, MAX_AVATAR_SIZE } from "../../../shared/schemas/upload";
import type { AppEnv } from "../../env";
import { resolveProjectAccess, resolveTaskAccess } from "../../lib/access";
import { errorResponse } from "../../lib/error-response";
import { detectMimeType } from "../../lib/mime-detect";
import { requireParam, requireParams } from "../../lib/params";
import { deleteObject, generateObjectKey, getObject, putObject } from "../../lib/storage";
import { tokenAllowsProject } from "../../middleware/authorize";

export async function uploadAvatar(c: Context<AppEnv>) {
  const storage = c.env.STORAGE;
  if (!storage) return errorResponse(c, "File storage is not configured", 503);

  const user = c.get("user")!;

  const formData = await c.req.parseBody();
  const file = formData["file"];

  if (!(file instanceof File)) {
    return errorResponse(c, "No file provided", 400);
  }

  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return errorResponse(c, "Invalid file type. Allowed: JPEG, PNG, GIF, WebP", 400);
  }

  if (file.size > MAX_AVATAR_SIZE) {
    return errorResponse(c, "File too large. Maximum size is 2MB", 400);
  }

  const db = c.get("db");

  // Find old avatar first (before uploading new one)
  const [oldAvatar] = await db
    .select()
    .from(upload)
    .where(and(eq(upload.userId, user.id), eq(upload.purpose, "avatar")))
    .limit(1);

  // Upload new file FIRST — if this fails, old avatar is still intact
  const key = generateObjectKey("avatar", user.id, file.name);
  const arrayBuffer = await file.arrayBuffer();

  // Validate file content against magic bytes — don't trust client-provided MIME type
  const detectedMime = detectMimeType(arrayBuffer, file.type);
  if (!detectedMime) {
    return errorResponse(c, "File content does not match its declared type", 400);
  }

  const verifiedMimeType = detectedMime;

  try {
    await putObject(storage, key, arrayBuffer, {
      mimeType: verifiedMimeType,
      filename: file.name,
    });
  } catch (error) {
    console.error("Failed to upload file to R2:", { userId: user.id, key }, error);
    return errorResponse(c, "Failed to upload file", 500);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  const record = {
    id,
    userId: user.id,
    key,
    filename: file.name,
    mimeType: verifiedMimeType,
    size: file.size,
    purpose: "avatar" as const,
    createdAt: now,
  };

  const avatarUrl = `/api/uploads/${key}`;

  try {
    await db.batch([
      db.insert(upload).values(record),
      db
        .update(userTable)
        .set({ image: avatarUrl, updatedAt: now })
        .where(eq(userTable.id, user.id)),
    ] as const);
  } catch (error) {
    // Clean up orphaned R2 object and any partially-inserted upload record
    await deleteObject(storage, key).catch((err) => console.error("Failed to clean up orphaned avatar R2 object:", { userId: user.id, key }, err));
    await db.delete(upload).where(eq(upload.id, id)).catch((err) => console.error("Failed to clean up orphaned avatar upload record:", { userId: user.id, uploadId: id }, err));
    console.error("Failed to save upload record:", { userId: user.id, uploadId: id, key }, error);
    return errorResponse(c, "Failed to save upload", 500);
  }

  // Clean up old avatar AFTER new one is fully saved
  if (oldAvatar) {
    await deleteObject(storage, oldAvatar.key).catch((err) => console.error("Failed to delete old avatar R2 object:", { userId: user.id, key: oldAvatar.key }, err));
    await db.delete(upload).where(eq(upload.id, oldAvatar.id)).catch((err) => console.error("Failed to delete old avatar upload record:", { userId: user.id, uploadId: oldAvatar.id }, err));
  }

  return c.json({
    upload: {
      id: record.id,
      url: avatarUrl,
      filename: record.filename,
      mimeType: record.mimeType,
      size: record.size,
    },
  });
}

/**
 * The only `upload.purpose` value whose objects are readable by every signed-in
 * user without an object-level ownership check.
 *
 * ## Why avatars are deliberately different
 *
 * An avatar is not tenant data. It is written to `user.image` by
 * {@link uploadAvatar} and then embedded in dozens of API payloads that a
 * legitimate viewer already receives — project member rosters, comment authors,
 * task assignees, activity actors, notification actors, attachment uploaders.
 * The image URL is therefore already disclosed to anyone entitled to see the
 * person; gating the bytes would only duplicate a check that has already
 * happened upstream, and it would need a "which users may this viewer see?"
 * query on *every* `<img>` in the app — a per-request join for zero real
 * confidentiality gain.
 *
 * It is still behind `requireAuth` at the route layer, so avatars are visible
 * to signed-in users only, never to the open internet. That is the intended
 * boundary: authenticated-but-not-object-authorized.
 *
 * Every other purpose is tenant data and MUST be resolved back to an owning
 * task or project — see {@link isUploadAuthorized}.
 */
const PUBLIC_UPLOAD_PURPOSE = "avatar";

/**
 * Does the calling PAT (if the request is PAT-authenticated) permit reading
 * data belonging to this project?
 *
 * Cookie-authenticated requests carry no `apiToken` and pass straight through —
 * their authorization was fully decided by `resolveProjectAccess` /
 * `resolveTaskAccess`.
 *
 * For PAT callers there are two independent narrowings, and both must hold:
 *
 * 1. **Workspace binding.** A token minted in workspace A may never read
 *    workspace B's files, even when the token's owner is a member of both —
 *    "the token is the workspace boundary, not the user"
 *    (see `requireWorkspaceMember` in `middleware/authorize.ts`).
 * 2. **Project selection.** The `projectScope: "all" | "selected"` policy,
 *    which bottoms out in `canAccessProject` in `lib/api-tokens.ts`.
 *
 * Without this, a deliberately narrowed token would still be able to download
 * every attachment and cover image its owner can reach — the same
 * broken-object-level-authorization class this route is being fixed for, one
 * credential layer down.
 *
 * This delegates to `tokenAllowsProject` rather than restating the rule. The
 * previous body was a verbatim second copy of that predicate, written before it
 * was exported; a duplicated authorization policy is one that eventually
 * disagrees with itself, and the half that drifts is the half nobody is looking
 * at. Anything the shared predicate learns — new scope modes, a tightened
 * workspace binding — now reaches this route for free.
 */
function patPermitsProject(
  c: Context<AppEnv>,
  owner: { id: string; workspaceId: string },
): boolean {
  return tokenAllowsProject(c.get("apiToken"), owner);
}

/**
 * How many claiming rows to pull before giving up on disambiguating a cover
 * key. Legitimately there is always exactly one (see `resolveCoverOwner`), so
 * anything past a handful is noise from an attacker spraying claims, and
 * scanning further only buys them a more expensive request.
 */
const MAX_COVER_CLAIMS_EXAMINED = 8;

/**
 * Decide which of the rows claiming a cover key actually owns it.
 *
 * ## Why a cover needs this and an attachment does not
 *
 * A cover is authorized through the row that *references* its key
 * (`task.cover_image_key` / `project.cover_image_key`), so that reference is a
 * security-relevant claim. Legitimately it is unique: `handleUploadCover` is the
 * only writer of a non-null cover key, it writes one entity per uploaded object,
 * and replacing or deleting a cover removes the previous R2 object and `upload`
 * row together. Every other path that touches the column (project/task
 * duplicate, workspace import, recurring-instance spawn) writes `null`.
 *
 * The claim used to be *forgeable*, which is why this function exists at all:
 * `updateTaskSchema` and `updateProjectSchema` accepted a client-supplied
 * `coverImageKey` and both update handlers persisted it unchecked, so anyone
 * holding a cover URL — which every project member receives in the project/task
 * JSON — could point their own task or project at it, and a naive `.limit(1)`
 * would hand them the bytes whenever their row happened to be scanned first.
 * Both schemas now omit the field and both handlers document that it must never
 * be added back (`shared/schemas/task.ts`, `shared/schemas/project.ts`), so on
 * the current tree there is no write path that can produce a second claim.
 *
 * This function is kept as the enforcement of that invariant rather than as its
 * assumption. It is the only place a contested key is *detected*, so collapsing
 * it into a `.limit(1)` would mean the day the column becomes writable again —
 * by a new endpoint, an importer, or a restored row — the regression is a
 * silent cross-tenant read with nothing to notice it. The rest of this doc is
 * therefore about what happens if a second claim ever appears, not about a hole
 * that is currently open.
 *
 * ## Why the tie is broken by the uploader, not by failing closed
 *
 * Failing closed on any contested key looks safer and is not: it hands any
 * current or former member a one-request, endlessly-repeatable way to blank out
 * a cover for everyone who legitimately sees it. Trading a confidentiality bug
 * for a remote availability bug is not a fix.
 *
 * So the tie is broken by `upload.userId` — the uploader, which no API can
 * rewrite. The real owner is the claiming row the uploader can actually reach:
 * they uploaded the cover *to* that task or project, so they had access to it.
 * A forger's row fails that test, because the uploader is a stranger to the
 * forger's project.
 *
 * Crucially this runs ONLY as a disambiguator. A single, uncontested claim is
 * honoured without consulting the uploader at all — otherwise every cover
 * uploaded by someone who later left the workspace (or whose account was
 * deleted, since `upload.userId` is `ON DELETE SET NULL`) would silently stop
 * rendering on a routine offboarding.
 *
 * If the uploader can reach several claims, or none, the key is genuinely
 * ambiguous and nobody gets it — that residual needs the uploader to be a member
 * of the forger's project too, which requires the forger to get them into their
 * workspace first.
 *
 * ## The residual this used to carry, and why it is closed
 *
 * A claim on an ORPHANED cover used to succeed: deleting a task or project drops
 * the row but leaves the R2 object and `upload` record behind, so a forger's
 * claim was the only one and was honoured as uncontested. That needed the
 * forgeable write, and the forgeable write is gone — with no way to point a row
 * at someone else's key, an orphaned object has no claimants at all and
 * `claims.length === 0` denies. Do not reintroduce a client-writable
 * `coverImageKey` on the strength of this function existing; it disambiguates
 * contested claims, it cannot tell an honest claim from a forged one.
 */
async function resolveCoverOwner<TRow extends { id: string }>(
  claims: TRow[],
  getUploaderId: () => Promise<string | null>,
  uploaderCanReach: (entityId: string, uploaderId: string) => Promise<boolean>,
): Promise<TRow | null> {
  if (claims.length === 0) return null;
  if (claims.length === 1) return claims[0];

  const uploaderId = await getUploaderId();
  if (!uploaderId) return null;

  let owner: TRow | null = null;
  for (const claim of claims) {
    if (!(await uploaderCanReach(claim.id, uploaderId))) continue;
    // A second reachable claim means the uploader is a member of both the real
    // and the forged home. Undecidable — deny rather than guess.
    if (owner) return null;
    owner = claim;
  }
  return owner;
}

/**
 * The id of the account that uploaded the object stored at `key`.
 *
 * Read from the `upload` row rather than from the key's middle segment: both
 * normally agree (`generateObjectKey` embeds the uploader), but the segment is
 * URL input and the column is not, and this value is used to break an ownership
 * tie. Purpose is matched too, so a row of a different kind can never answer for
 * this key. Returns `null` when there is no record, or when the uploader's
 * account has since been deleted (`ON DELETE SET NULL`).
 */
async function uploaderOfKey(
  db: Database,
  key: string,
  purpose: string,
): Promise<string | null> {
  const [row] = await db
    .select({ userId: upload.userId })
    .from(upload)
    .where(and(eq(upload.key, key), eq(upload.purpose, purpose)))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Resolve an R2 object key back to the resource that owns it and decide whether
 * `userId` may read it.
 *
 * ## Why the URL's `purpose` segment is trustworthy here
 *
 * `generateObjectKey` (lib/storage.ts) always writes `<purpose>/<uploaderId>/<uuid><ext>`,
 * and the caller composes the lookup key from the very same segments it
 * switches on. So the branch taken and the key looked up always agree: an
 * object stored under `task-attachment/…` can only ever be found by the
 * `task-attachment` branch. An attacker cannot pick the cheap `avatar` branch
 * for an attachment's key, because asking for the `avatar` branch also changes
 * the key being fetched to one that does not exist.
 *
 * That equivalence is what makes the caller's segment-shape guard load-bearing;
 * see {@link serveUpload}.
 *
 * ## Fail-closed by default
 *
 * `upload.purpose` is a free-text column, so this switch enumerates every value
 * the writers actually produce (`avatar`, `task-attachment`, `task-cover`,
 * `project-cover`) and **denies anything else**. A future purpose added without
 * a branch here is unreadable rather than world-readable — the safe direction
 * for the failure.
 *
 * ## Why each private branch looks the way it does
 *
 * The row lookups only resolve *which* task/project owns the key; the actual
 * access decision is always delegated to `resolveTaskAccess` /
 * `resolveProjectAccess`, which are the single source of truth for the
 * workspace-owner/admin elevation and direct-project-membership rules. Copying
 * that logic into a hand-rolled join here would have made this a second,
 * silently-diverging copy of the permission model.
 *
 * A cover is authorized through the row that *references* the key
 * (`task.cover_image_key` / `project.cover_image_key`) rather than through the
 * `upload` row, because the `upload` row records only who uploaded the file —
 * not who is entitled to look at it, which is a different set of people
 * entirely.
 */
async function isUploadAuthorized(
  c: Context<AppEnv>,
  db: Database,
  purpose: string,
  key: string,
  userId: string,
): Promise<boolean> {
  switch (purpose) {
    case PUBLIC_UPLOAD_PURPOSE:
      return true;

    case "task-attachment": {
      // upload → task_attachment gives us the owning task. An attachment whose
      // join row is gone (deleted attachment, orphaned object) has no owner and
      // is therefore readable by nobody.
      //
      // No `resolveCoverOwner`-style disambiguation is needed here: unlike a
      // cover key, this reference is unforgeable. `task_attachment` rows are
      // written only by `uploadAttachment`, in the same batch that mints the
      // `upload` row, and no endpoint accepts an `uploadId`. If a future feature
      // ever attaches one upload to several tasks (e.g. copying attachments on
      // task duplicate), every claim would be legitimate and taking the first
      // would still be wrong — that feature must revisit this branch.
      const [row] = await db
        .select({ taskId: taskAttachment.taskId })
        .from(taskAttachment)
        .innerJoin(upload, eq(taskAttachment.uploadId, upload.id))
        .where(eq(upload.key, key))
        .limit(1);
      if (!row) return false;

      const result = await resolveTaskAccess(db, row.taskId, userId);
      if (!result.found || !result.access) return false;
      return patPermitsProject(c, result.access.project);
    }

    case "task-cover": {
      const row = await resolveCoverOwner(
        await db
          .select({ id: task.id })
          .from(task)
          .where(eq(task.coverImageKey, key))
          .limit(MAX_COVER_CLAIMS_EXAMINED),
        () => uploaderOfKey(db, key, purpose),
        async (taskId, uploaderId) => {
          const r = await resolveTaskAccess(db, taskId, uploaderId);
          return r.found && r.access !== null;
        },
      );
      if (!row) return false;

      const result = await resolveTaskAccess(db, row.id, userId);
      if (!result.found || !result.access) return false;
      return patPermitsProject(c, result.access.project);
    }

    case "project-cover": {
      const row = await resolveCoverOwner(
        await db
          .select({ id: project.id })
          .from(project)
          .where(eq(project.coverImageKey, key))
          .limit(MAX_COVER_CLAIMS_EXAMINED),
        () => uploaderOfKey(db, key, purpose),
        async (projectId, uploaderId) =>
          (await resolveProjectAccess(db, projectId, uploaderId)) !== null,
      );
      if (!row) return false;

      const access = await resolveProjectAccess(db, row.id, userId);
      if (!access) return false;
      return patPermitsProject(c, access.project);
    }

    default:
      return false;
  }
}

/**
 * Stream a stored R2 object, after proving the caller is entitled to it.
 *
 * ## The bug this shape exists to prevent
 *
 * This route used to build the R2 key from the URL segments and stream the
 * bytes with `requireAuth` as its only guard. The `:userId` segment is
 * attacker-supplied — it is the *uploader's* id, never the caller's — so any
 * signed-in account could read any file in the system: another tenant's task
 * attachments, task covers and project covers, including after being removed
 * from the workspace. The metadata endpoints for the same task correctly
 * returned 403 while the file itself was open, which is the defining shape of a
 * broken-object-level-authorization flaw. Authorization now happens BEFORE the
 * R2 read, so an unauthorized caller cannot even cause a fetch of the object.
 *
 * ## Uniform 404, never 403
 *
 * Every *authorization* denial returns the same `404 File not found` as a
 * genuinely missing object. (Missing authentication is still a 401 — that is a
 * different question, answered before any object is named.)
 * These URLs are unguessable capabilities (UUID keys), not
 * addressable ids the caller could have obtained from a listing, so a 403 would
 * add a bit of information the caller did not have: "this object exists and
 * belongs to someone else". That turns a URL leaked into a browser history,
 * referrer header, chat message or log line into a positive existence oracle.
 * This mirrors the calendar ICS feed handler, which returns a uniform 404 for
 * every failure mode for exactly this reason, and the notification handlers,
 * which 404 on another user's row. The 403 convention in `middleware/authorize.ts`
 * applies to the opposite situation — resources addressed by an id the caller
 * legitimately holds, where "you lack permission" is the honest and useful
 * answer.
 *
 * ## Cache-Control
 *
 * `public` on a private object invites shared caches (CDNs, corporate proxies)
 * to store one tenant's file and hand it to whoever asks next — the response is
 * per-user authorized, so it must never be treated as a shared resource. Private
 * purposes therefore get `private`, which still gives the browser the full
 * immutable year-long cache (keys are content-addressed by UUID and never
 * rewritten) without permitting an intermediary copy. Avatars keep `public`
 * because they are the same bytes for every authorized viewer — see
 * {@link PUBLIC_UPLOAD_PURPOSE}.
 */
export async function serveUpload(c: Context<AppEnv>) {
  const storage = c.env.STORAGE;
  if (!storage) return errorResponse(c, "File storage is not configured", 503);

  // Defence in depth: the route mounts `requireAuth`, but this handler must not
  // become world-readable if it is ever remounted without it.
  const user = c.get("user");
  if (!user) return errorResponse(c, "Unauthorized", 401);

  const { purpose, userId, filename } = requireParams(c, "purpose", "userId", "filename");

  // Percent-encoded separators (`%2F`) survive Hono's param decoding, so a
  // three-segment route can still yield a segment containing "/". Reject those
  // outright: the purpose→key-prefix equivalence that `isUploadAuthorized`
  // relies on only holds while the key has exactly three segments, and a key
  // like `avatar/x/../task-attachment/…` must never take the avatar branch.
  if (purpose.includes("/") || userId.includes("/") || filename.includes("/")) {
    return errorResponse(c, "File not found", 404);
  }

  const key = `${purpose}/${userId}/${filename}`;

  const db = c.get("db");
  if (!(await isUploadAuthorized(c, db, purpose, key, user.id))) {
    return errorResponse(c, "File not found", 404);
  }

  const object = await getObject(storage, key);
  if (!object) {
    return errorResponse(c, "File not found", 404);
  }

  const isPublic = purpose === PUBLIC_UPLOAD_PURPOSE;
  c.header(
    "Cache-Control",
    `${isPublic ? "public" : "private"}, max-age=31536000, immutable`,
  );

  const contentType = object.httpMetadata?.contentType ?? "application/octet-stream";
  c.header("Content-Type", contentType);

  // Force download for non-image task-attachments to prevent browser execution
  if (purpose === "task-attachment" && !contentType.startsWith("image/")) {
    const originalFilename = object.customMetadata?.filename ?? filename;
    // Sanitize filename for Content-Disposition header to prevent header injection
    const safeFilename = originalFilename.replace(/[\r\n"\\]/g, "_");
    c.header("Content-Disposition", `attachment; filename="${safeFilename}"`);
  }

  return c.body(await object.arrayBuffer());
}

export async function deleteUpload(c: Context<AppEnv>) {
  const storage = c.env.STORAGE;
  if (!storage) return errorResponse(c, "File storage is not configured", 503);

  const user = c.get("user")!;
  const id = requireParam(c, "id");
  const db = c.get("db");

  // Batch the lookup and ownership-scoped delete in a single DB round-trip.
  // The delete WHERE includes userId so it's a no-op when ownership fails.
  const [selectResult] = await db.batch([
    db.select().from(upload).where(eq(upload.id, id)).limit(1),
    db.delete(upload).where(and(eq(upload.id, id), eq(upload.userId, user.id))),
  ] as const);

  const record = selectResult[0];

  if (!record) {
    return errorResponse(c, "Upload not found", 404);
  }

  if (record.userId !== user.id) {
    return errorResponse(c, "Forbidden", 403);
  }

  await deleteObject(storage, record.key).catch((err) => {
    console.error("Failed to delete object from storage:", { userId: user.id, uploadId: id, key: record.key }, err);
  });

  return c.json({ ok: true });
}

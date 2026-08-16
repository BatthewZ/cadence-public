import { Hono } from "hono";

import type { AppEnv } from "../../env";
import {
  requireReadScopeForResource,
  requireWriteScopeForResource,
} from "../../middleware/authorize";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { deleteUpload, serveUpload, uploadAvatar } from "./uploads.handlers";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// PAT scope enforcement
// ---------------------------------------------------------------------------
//
// These routes carry the file BYTES. `serveUpload` was given per-resource
// authorization — a task attachment resolves back to its owning task and is
// checked against the caller's project access — but authorization and
// capability are different questions, and only the first was being asked. A
// token minted with nothing but `team:read` still downloaded attachments for
// every project its holder could reach, because no scope check stood between
// it and the handler.
//
// The scope family is `attachment`, matching the resource the bytes belong to.
// Mounted per exact path: Hono's `app.use` with a literal pattern matches that
// path only, so a parent-path mount would not cover these.
//
// This also applies to `purpose = "avatar"`, which is deliberate. Avatars stay
// readable by any signed-in HUMAN — that is unchanged, because these
// middlewares no-op without a PAT — but a machine credential asking for file
// bytes should have to say it wants file access, whichever bucket they sit in.
// The alternative, exempting one purpose inside the middleware, would put a
// per-purpose branch in the capability layer that the authorization layer
// already owns, and split one policy across two places.
const attachmentReadScope = requireReadScopeForResource("attachment");
const attachmentWriteScope = requireWriteScopeForResource({ resource: "attachment" });

app.use("/users/me/avatar", attachmentReadScope, attachmentWriteScope);
app.use("/uploads/:purpose/:userId/:filename", attachmentReadScope, attachmentWriteScope);
// There is no `attachment:delete` in the v1 grammar, so `allowDelete` stays
// false and DELETE falls under `attachment:write` — the same treatment
// `workspace` gets in `workspaces.routes.ts`.
app.use("/uploads/:id", attachmentReadScope, attachmentWriteScope);

app.put(
  "/users/me/avatar",
  requireAuth,
  rateLimit({ max: 10, windowSeconds: 60, prefix: "avatar-upload", keyFn: defaultRateLimitKey }),
  uploadAvatar,
);

app.get(
  "/uploads/:purpose/:userId/:filename",
  requireAuth,
  rateLimit({ max: 100, windowSeconds: 60, prefix: "file-serve", keyFn: defaultRateLimitKey }),
  serveUpload,
);

app.delete("/uploads/:id", requireAuth, deleteUpload);

export default app;

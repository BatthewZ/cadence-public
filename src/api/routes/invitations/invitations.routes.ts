import { Hono } from "hono";

import {
  acceptInvitationSchema,
  createInvitationSchema,
} from "../../../shared/schemas/invitation";
import type { AppEnv } from "../../env";
import {
  rejectPatAuth,
  requireWorkspaceRole,
  requireWriteScopeForResource,
} from "../../middleware/authorize";
import { defaultRateLimitKey, rateLimit } from "../../middleware/rate-limit";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody } from "../../middleware/validate";
import {
  acceptInvitation,
  createInvitation,
  getInvitation,
  getInvitationLink,
  listInvitations,
  listMyPendingInvitations,
  revokeInvitation,
} from "./invitations.handlers";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// PAT scope enforcement
// ---------------------------------------------------------------------------
//
// Per the doc, `invitation:write` is the only invitation scope — there is
// no `invitation:read` in v1 because listing invitations is admin-only and
// admins can use a cookie session for that view.
//
// The mounts below cover the workspace-scoped invitation routes only. The
// public `/invitations/*` paths carry no scope requirement, and each has its
// own reason:
//
//   - `GET /invitations/:token` is unauthenticated by design (the invitee has
//     no account yet), so there is no token to scope. Possession of the
//     invitation token is the whole credential; a rate limit is the control.
//   - `POST /invitations/accept` is authenticated but mounts `rejectPatAuth()`
//     instead of a scope. An earlier version of this comment claimed the route
//     "cannot be reached by a PAT because it runs in the cookie-auth user
//     context" — that was FALSE, and the confidence in it is what left the
//     hole standing. `authSessionMiddleware` bridges a verified PAT into
//     `c.get("user")` as an ordinary user, so a token minted with nothing but
//     `task:read` satisfied `requireAuth` and reached the handler, where it
//     could insert a `workspace_member` row, flip an invitation to accepted,
//     and fire `invitation.accepted` / `workspace.member_joined`. See the
//     mount on the accept route for the full rule.
const invitationWriteScope = requireWriteScopeForResource({ resource: "invitation" });

app.use("/workspaces/:workspaceId/invitations", invitationWriteScope);
app.use("/workspaces/:workspaceId/invitations/:id", invitationWriteScope);
// Hono's `app.use` with a literal pattern matches that path only, so the
// nested `/link` route needs its own mount rather than inheriting the one
// above.
app.use("/workspaces/:workspaceId/invitations/:id/link", invitationWriteScope);

// Create invitation
//
// The rate limit is not generic hygiene: creating an invitation now *sends
// mail* to an attacker-chosen address with attacker-influenced content (the
// workspace name and the inviter's display name both appear in the body). An
// unlimited create endpoint is therefore a mail-bomb and reputation-burn
// primitive — a single compromised admin session could enqueue thousands of
// Resend deliveries from this deployment's sending domain, and the damage
// (domain blocklisting) outlives the session that caused it. It was harmless
// only while invitations were never delivered at all.
//
// 20/hour keyed per actor: a real admin onboarding an entire team in one
// sitting fits inside it, and the duplicate-pending guard in `createInvitation`
// already blocks repeat sends to the same address, so reaching this ceiling
// means 20 *distinct* new addresses in an hour. `defaultRateLimitKey` keys on
// the user (or PAT) rather than the IP so that a shared office egress does not
// make one admin's bulk onboarding exhaust everyone else's budget.
//
// Mounted after `requireWorkspaceRole` — matching `workspaces.routes.ts` — so
// that only authorised calls consume quota and a rejected non-admin cannot
// spend an admin's allowance.
app.post(
  "/workspaces/:workspaceId/invitations",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  rateLimit({
    max: 20,
    windowSeconds: 3600,
    prefix: "invitation-create",
    keyFn: defaultRateLimitKey,
  }),
  validateBody(createInvitationSchema),
  createInvitation,
);

// List pending invitations
app.get(
  "/workspaces/:workspaceId/invitations",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  listInvitations,
);

// Copy-link fallback for a pending invitation. Same role guard as the list it
// is rendered from (owner/admin of the workspace), but the token is handed
// over only when explicitly requested — see `getInvitationLink`.
//
// `rejectPatAuth()` is load-bearing here, not decoration. This is the ONLY
// endpoint that still returns a raw invitation token, and the scope machinery
// cannot protect it: `requireWriteScopeForResource` deliberately no-ops on
// safe methods, and there is no `invitation:read` scope in the v1 grammar to
// mount instead. Without this line any PAT held by an owner/admin — including
// one minted with nothing but `task:read` — would satisfy `requireAuth` and
// `requireWorkspaceRole` (PAT auth bridges a real user into the context) and
// could harvest a working invite. That is the same rule the PAT-management
// and calendar-feed surfaces already follow: a machine credential must never
// be able to mint or harvest another credential. Copying an invite link is a
// human recovery action taken from the members page, so nothing legitimate is
// lost by refusing tokens outright.
app.get(
  "/workspaces/:workspaceId/invitations/:id/link",
  requireAuth,
  rejectPatAuth("API tokens cannot retrieve invitation links"),
  requireWorkspaceRole("owner", "admin"),
  getInvitationLink,
);

// Revoke invitation
app.delete(
  "/workspaces/:workspaceId/invitations/:id",
  requireAuth,
  requireWorkspaceRole("owner", "admin"),
  revokeInvitation,
);

// List pending invitations for the authenticated user
//
// `rejectPatAuth()` closes the last unguarded step of the credential-
// acquisition path. This endpoint enumerates precisely the invitations the
// caller is able to accept, and `POST /invitations/accept` already refuses
// tokens — so leaving the lookup open kept the discovery half of the same
// sequence reachable by a machine credential. The rule this follows is the
// one stated on the `/link` mount above: a machine credential must never be
// able to mint or harvest another credential, and an invitation is one.
//
// It also closes a workspace-binding hole, which is why refusal is the right
// treatment rather than a filter. The handler selects by the caller's EMAIL,
// not by workspace, so it returned the id and name of every workspace that had
// invited them — including workspaces the token was never bound to. Filtering
// to the token's workspace would fix the leak while leaving a token able to
// enumerate invitations for its owner, which serves no integration and is the
// shape the rule above exists to forbid.
//
// Nothing legitimate is lost: reviewing your own invitations is a human action
// taken from the workspace switcher, and browser sessions are unaffected.
app.get(
  "/invitations/pending",
  requireAuth,
  rejectPatAuth("API tokens cannot list invitations"),
  listMyPendingInvitations,
);

// Get invitation by token (public, no auth)
app.get(
  "/invitations/:token",
  rateLimit({ max: 10, windowSeconds: 60, prefix: "invitation-lookup" }),
  getInvitation,
);

// Accept invitation
//
// `rejectPatAuth()` is the security control on this route, and it is the only
// thing standing between a read-only API token and workspace membership.
//
// The hole it closes: `authSessionMiddleware` verifies a PAT and then bridges
// its owner into `c.get("user")` as an ordinary user, so from `requireAuth`'s
// point of view a PAT request is indistinguishable from a cookie session. With
// only `requireAuth` + rate limit + `validateBody` on this route, a token
// minted with nothing but `task:read` could perform a membership-granting
// WRITE — insert a `workspace_member` row, flip an invitation to accepted, and
// emit `invitation.accepted` and `workspace.member_joined` webhooks. The scope
// machinery could not have caught it either: there is no scope mounted here,
// and adding one would only ask "does this token hold `invitation:write`?"
// when the correct answer is "no token may do this at all".
//
// Why no token, not merely a scoped one: accepting an invitation converts a
// bearer credential into durable membership — a second, longer-lived
// credential of a different class. That is precisely the rule the
// PAT-management, calendar-feed and `/link` surfaces already enforce with this
// same middleware. Joining a workspace is a human act taken from a browser
// after clicking a link in a mailbox the human controls; an integration has no
// legitimate reason to perform it, so nothing real is lost by refusing.
//
// Mounted before `validateBody` so a PAT is refused without the server first
// parsing an attacker-supplied body, and before the rate limiter so that
// rejected machine traffic cannot consume a human's accept budget.
app.post(
  "/invitations/accept",
  requireAuth,
  rejectPatAuth("API tokens cannot accept invitations"),
  rateLimit({ max: 10, windowSeconds: 60, prefix: "invitation-accept", keyFn: defaultRateLimitKey }),
  validateBody(acceptInvitationSchema),
  acceptInvitation,
);

export default app;

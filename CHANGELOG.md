# Changelog

All notable changes to Cadence are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [1.33.0] - 2026-08-16

### Security

- **Issuing an API token now requires the workspace owner or admin role.** Minting a personal access token and rotating one both put a new secret into someone's hands, which is an administrative act — until now any workspace member could do either for themselves. `POST /api/workspaces/:workspaceId/api-tokens` and `POST /api/workspaces/:workspaceId/api-tokens/:tokenId/rotate` now answer `403` to a member. Rotation is gated alongside minting rather than left with the read endpoints because it mints a sibling carrying a fresh secret: at member level it would let someone demoted to member renew an existing credential indefinitely and walk around the policy entirely. Rotation additionally stays owner-of-the-token-only — being an admin still does not let you rotate someone else's token, because the response carries the new plaintext, and the admin remediation is to revoke. **Nothing is invalidated retroactively.** Tokens minted before this release, and tokens held by someone since demoted to member, keep working until they expire or are revoked; the change gates issuance, not use. A member who needs a token for an integration asks an owner or admin to issue one, and a long-lived integration token is best owned by an admin, since a member cannot renew one.
- **A member keeps the two token actions that reduce risk rather than create it.** They still see every token they own — scopes, project access, last-used and expiry — so they can audit their own footprint, and they can still revoke any of them immediately without asking anyone. Because revocation is one-way for them, a member who revokes their last token needs an owner or admin to issue the replacement. Owners and admins continue to see every member's token in the workspace listing and can revoke deliberately. The full policy, both axes of it, is in the [API token guide](docs/api/api-tokens.md#authorization-policy).

### Changed

- **Settings tabs a member cannot act on now explain themselves instead of failing.** API Tokens and Webhooks join Data in staying visible in the settings navigation while saying what the restriction is and who to ask — hiding a tab leaves someone unable to tell a missing feature from a missing permission — and the controls behind the note are absent rather than present-and-refused. On API Tokens the **New Token** button is gone and the per-token **Rotate** action is disabled, while **Revoke** stays live. All three notes now wait until the viewer's role is actually known: an unresolved role is indistinguishable from `member`, and telling an admin they lack permission and then retracting it is worse than a beat of nothing. The controls stay closed while that resolves, so the wait never opens anything.
- **The webhooks settings page no longer requests a list a member may not read.** Reading workspace webhooks has always been owner/admin-only on the server, so a member opening the tab issued a request guaranteed to be refused and got a bare "Forbidden" banner for it. The request is no longer made and the explanatory note is the page. A member is also no longer shown "No webhooks", which asserted an empty list that had never been fetched.

## [1.32.0] - 2026-08-16

### Fixed

- **An open task stops going stale the moment you open it.** A task detail view — the dialog opened from a board, the dashboard or My Tasks, and the full-page panel — kept its own working copy of the task and only ever accepted three things back from the server: subtasks, the comment count, and labels. Every other field a colleague changed while you had the task open was fetched and then discarded, so a task you were reading showed the title, description, assignee, due date, priority, status and cost as they were at the instant you opened it, while the board behind it updated normally. The longer a task stayed open — which for a task being discussed is the whole conversation — the further it drifted, and nothing on screen suggested you were looking at a snapshot. The view now adopts the server's row in full, so a collaborator's edit appears while you are looking at it. Anything you are part-way through typing is untouched: a field you have edited but not yet saved is never overwritten, and an open description draft is never replaced.
- **A change made elsewhere in the workspace now reaches an open task.** The freshness check that tells a client something changed reports only that *some* task in the project or workspace was modified — not which one — so an open task detail view was never included in the refresh it triggered. It now is, which is what carries the fix above from the board into the task you have open. Only the view actually on screen refetches; everything else is simply marked for refresh the next time it is shown.

### Changed

- **Background polling intervals are now slightly randomised per client.** Every open client polled on exactly the same fixed cadence — 1.5s for a project, 3s for a workspace, 30s for the unread-notification count — so everyone viewing the same project detected the same change inside the same window and then issued the same follow-up refetches within milliseconds of each other. Each interval is now spread by ±20%, re-rolled on every tick, which staggers those clients instead of stacking them. Nothing about how quickly a change reaches you changes in practice; the averages are the same intervals as before.

### Added

- **A project member's role can now be changed without removing and re-adding them.** **Project Settings > Members** has always let an admin add people and remove them, but the role picked at the moment of adding was final — correcting it meant removing the person and adding them back, which is a destructive round trip for what is usually a typo. The row's **…** menu now offers **Change Role** alongside **Remove**, opening a picker pre-selected to the role they currently hold. Any project admin may re-role any other project member: projects have no owner tier and no rank between admins, so this deliberately does not copy the workspace hierarchy — and a rule blocking peers here would be routed around by the Remove item next to it, which has always allowed removing a fellow admin. The one refusal is your own row, because a self-demotion is the single change the person making it cannot undo — drop yourself to viewer and the settings page you did it from is closed to you.
- **Each role picker now says what the role can do.** Both the Add Member and Change Role dialogs show a one-line summary under the selection, and the [user guide](docs/guides/user-guide.md#project-roles) carries the full capability table. The two boundaries that matter are Viewer to Member, which is the line between reading and writing, and Member to Admin, which is the line between using a project and administering it — neither is legible from the role name alone, and choosing wrong either locks a contributor out of the board or hands project administration to someone meant to file tickets.
- **New endpoint and webhook event.** `PATCH /api/projects/:projectId/members/:userId` takes `{ "role": "admin" | "member" | "viewer" }` and fires `project.member_role_changed` with a `changes` object naming the old and new role. Sending the role a member already holds is accepted as a no-op — the row comes back unchanged and no event fires, since a change event whose `from` equals its `to` is a lie every consumer would have to filter out. The write is pinned to the role it was authorized against, so if someone else re-roles the same member while your dialog is open the request is refused with `409` rather than applied on top of theirs.
- **Workspace admins can now decide whether members may create projects.** Until now any workspace member could, identically in every workspace, and that stays the default — a six-person team wants zero friction, but a larger org where a project maps onto a client or a cost centre wants a gate, and that is the workspace's call rather than the product's. **Settings > General > Member Permissions** carries the switch for owners and admins; it applies on release rather than behind a Save button, because a governance switch resting in an unsaved state displays a position that is not in force. Admins are never subject to it, so turning it off cannot lock out the only people who could turn it back on, and nothing about existing projects changes — members keep every project they are already on, including project-admin on projects they created. The setting is not a containment boundary and is not offered as one: owners and admins already hold admin access to every project in the workspace, so what it buys is process, not privacy.
- **Duplicating a project is governed by the same setting.** Otherwise it would be decorative: creating a project makes you its admin, so a member who created one while the setting was on would keep passing the project-admin check on it forever and could go on minting projects by copying it. Both paths now answer `403` for a member while the setting is off, and that `403` says which setting and who owns it rather than the deliberately-generic "Forbidden" the membership and token-scope guards return — the caller has already proved workspace membership, so there is nothing left to conceal, and a bare refusal would send an integrator hunting for a scope bug. Workspace import also creates projects and is deliberately untouched, being owner/admin-only already.
- **Members are told what happened instead of finding a dead button.** **New Project** stays where it is but is disabled and explains itself on hover, in the sidebar and on the projects page; the command palette drops **Create Project** entirely, because a row that looks selectable and refuses on Enter breaks what a palette is for and has nowhere to hover. The dashboard and projects empty states stop instructing a member to create their first project — the screen a newly-invited member lands on — and point them at an admin instead.
- **`PATCH /api/workspaces/:workspaceId` accepts a `policy` object**, merged rather than replaced, so two admins saving different toggles cannot clobber each other; an unknown key is a `400` rather than a silently-dropped field that leaves an admin certain they changed something they did not. `GET /api/workspaces/:workspaceId` returns `policy` fully resolved with defaults applied, so no client needs its own copy of the defaults. Stored as one JSON column with the defaults living in code and nothing backfilled — the next toggle is a field on an interface, and workspaces predating it pick it up correctly.

## [1.30.0] - 2026-08-15

### Security

- **File downloads are now authorized against the resource that owns the file.** A request to `/api/uploads/...` for a task attachment or a task/project cover image is resolved back to its owning task or project and checked against the caller's access to it, using the same permission rules as the rest of the API — so a file is readable by exactly the people who can already open the task or project it belongs to, and access ends the moment their membership does. Requests that are not permitted receive the same `404` as a file that does not exist. Private files are additionally served with `Cache-Control: private`, so shared caches and proxies never retain them while the browser keeps its long-lived cache. Profile avatars are unchanged — they remain readable by any signed-in user, because they are displayed throughout the app wherever a person is named.
- **A cover image can no longer be claimed by a task or project it was never uploaded to.** Because a cover image download is authorized by finding the task or project that references it, the reference itself has to be trustworthy. `coverImageKey` is therefore no longer accepted by `PATCH /api/projects/:projectId` or `PATCH /api/tasks/:taskId` — covers are set, replaced and removed only through the dedicated cover endpoints, which always write a key belonging to the caller's own upload. Setting a cover from the app is unchanged, including repositioning, which still travels through the ordinary update. A request that includes the field is not rejected; the field is simply ignored.
- **Duplicating a project no longer copies people who have left the workspace.** A project membership left behind when someone is removed from a workspace already grants nothing, but duplicating the project used to copy it onto the new project as if it were current. Duplication now applies the same rule as adding a member by hand — only people still in the workspace are carried over — and the response lists anyone left out in a `skippedMemberIds` array, so the omission is visible rather than silent. The field is always present on the `201`, empty when nothing was skipped.
- **A personal access token restricted to selected projects is now restricted on workspace-wide endpoints too.** A token's project selection has always been applied by the endpoints that name a project or task in their path. It is now also applied by the endpoints that do not: the workspace dashboard and its My Tasks and Upcoming lists, activity, search, notifications, labels, task groups, the project list, the workspace export, and the webhook endpoints. Each filters what it returns to the token's selected projects, or answers `403` where filtering would be meaningless — the whole-workspace export, and creating or repointing a webhook at a project outside the selection. **This narrows tokens that already exist.** A token with `projectScope: "selected"` can no longer list, read, delete or test-fire workspace-wide webhooks — those belonging to no single project — because a webhook is a project's egress configuration and a workspace-wide one carries projects outside the selection. A token's *project selection* is what changes here, so `projectScope: "all"` tokens keep the same project reach — but see the workspace-binding entry below, which does narrow them. Every request authenticated by a browser session is unaffected: this changes what a token may reach, not what a person may. An integration that depended on the wider reach should have its token's project selection widened rather than its scoping removed.
- **The dashboards, search, activity, the notification inbox and file downloads now require the API-token scopes they always claimed to.** Scopes are how a token says what it is for, and these endpoints never checked them — so a token created with, say, only team access could read task titles, due dates and assignees, cost and workload rollups, the full text of task changes, free-text search results, the notification inbox (whose entries quote task titles and comment excerpts), and any attachment its owner could reach. Each now requires the scope covering what it returns, listed under "Aggregate and cross-resource endpoints" in the [API token guide](docs/api/api-tokens.md). **This affects tokens that already exist.** A token minted before this release that reads any of these endpoints without holding `task:read` (or, for the two dashboards and search, `project:read` as well; for downloads, `attachment:read`) will now be refused, with a message naming the scope it needs — recreate it with those scopes ticked, or with the `read:*` aggregate, which covers all of them. Note that `write:*` does **not** grant reads: the two aggregates are separate, so a token that both reads and writes needs both. Browser sessions are unaffected: scopes apply to tokens, not to people.
- **Deleting a workspace, or removing a member from one, is now closed to a token restricted to selected projects.** Both actions reach every project in the workspace however narrow the token is: deleting a workspace destroys all of them, and removing a member revokes their access across all of them in a single all-or-nothing step. Both now answer `403` to a token with `projectScope: "selected"`, matching the workspace export, which already refused — a token that may not read a project should not be able to delete it or to alter who can reach it. Neither is narrowed rather than refused, because a partial version of either would be the more dangerous outcome: removing a member from only some of their projects leaves them half-removed, still a member of the workspace, which is the state member removal was corrected to avoid. Tokens with `projectScope: "all"`, and browser sessions, are unaffected.
- **A token now lists only the workspace it was issued for.** `GET /api/workspaces` answers from the person behind the request, so a token issued for one workspace returned the name, address and owner of every other workspace its holder happened to belong to. It now returns only the workspace the token is bound to. This applies to every token, including `projectScope: "all"` ones, because the workspace a token was issued for is a separate boundary from the projects it selects. The workspace switcher in the app is unchanged — browser sessions still see everything you belong to.
- **API tokens can no longer accept or list workspace invitations.** `POST /api/invitations/accept` and `GET /api/invitations/pending` authenticated with a personal access token are now refused with `403`, whatever the token's scopes. The pending list is how a caller discovers which invitations it is able to accept, so closing accept alone left the first half of the same sequence open; it also selects by the caller's email rather than by workspace, so it had been reporting the names of workspaces the token was never bound to. Because token authentication resolves to the token's owner as an ordinary user, a token minted with nothing but read access to tasks could previously join a workspace outright — writing the membership, consuming the invitation and emitting the accompanying `invitation.accepted` and `workspace.member_joined` events. Joining a workspace turns a bearer credential into durable membership, which is the same rule the API-token, calendar-feed and copy-invite-link surfaces already enforce: a machine credential must never obtain another credential. Reviewing and accepting invitations are human actions taken from the app, and both are unchanged for browser sessions.
- **Only a workspace owner can invite someone as an admin.** `POST /api/workspaces/:workspaceId/invitations` with `role: "admin"` now requires owner rank and answers `403` otherwise. Granting the admin role from the members list already required an owner, so leaving the invitation route open meant an admin who was blocked from promoting a colleague could invite a new admin instead and reach the same result through another door — and each admin so created was immediately immune to every other admin. Admins can still invite members, which is the whole of the authority they are meant to have.
- **A token now reaches only the projects and tasks of the workspace it was issued for.** A personal access token is bound to one workspace at mint time, and the endpoints that name a project, task, subtask, task group or comment in their path applied the token's project selection but never checked that binding — so a token issued for one workspace could read and write another workspace's projects and tasks whenever its holder happened to belong to both. Those endpoints now compare the workspace too and answer `403` otherwise. **This narrows tokens that already exist, `projectScope: "all"` ones included**, because the workspace a token was issued for is a separate boundary from the projects it selects — the same distinction as the workspace-list entry above. An integration that spanned two workspaces on a single token needs one token per workspace. Browser sessions are unaffected.
- **An invitation's token is no longer returned by the API.** `POST /api/workspaces/:workspaceId/invitations`, `GET /api/workspaces/:workspaceId/invitations` and `GET /api/invitations/pending` each used to include the raw `token` on every row. That token is the whole credential — whoever holds it can join the workspace once signed in — so it now leaves the server through exactly two doors: the invitation email, and the copy-link endpoint. **This changes responses existing clients already read.** The field is simply absent, nothing replaces it in the body, and the `Invitation` type no longer declares it. A client that assembled its own `/invite/:token` URL from the create response should fetch the link from `GET /api/workspaces/:workspaceId/invitations/:id/link` instead; because that endpoint is closed to personal access tokens, an integration that mints invitations now relies on the invitation email to deliver them. Accepting no longer needs the token at all: `POST /api/invitations/accept` takes `{ "invitationId": "…" }` as well as `{ "token": "…" }` — exactly one of the two, and sending both is a `400`.
- **A task can only be assigned to someone who can open its project.** `assigneeId` was written straight from the request body with no check, so a task could be handed to any user id — including an account with no connection to the workspace, which then received a notification naming the task and the person who assigned it, and saw the task in its own My Tasks list. `POST /api/projects/:projectId/tasks` and `PATCH /api/tasks/:taskId` now answer `400 "Assignee must have access to this project"` for anyone who is not a project member or a workspace owner or admin; nothing is written and no notification is sent. **This affects API clients that assign by user id.** Assigning `null`, assigning yourself, and re-sending a task's current `assigneeId` unchanged are all still accepted, so whole-object updates keep working after a membership change — existing assignments are left as they are rather than cleared out from under anyone. Where an assignee is inherited rather than named — duplicating a task, or the next occurrence of a repeating one — the operation still succeeds but an assignee who has since lost access is dropped, so the new task arrives unassigned. The same check gates the completion notification.
- **Removing someone from a workspace now removes them from its projects and teams as well.** Removal deleted the workspace membership and nothing else, so every project membership that person held kept working — they could still open, edit and export those projects, and they went on appearing in team rosters and member counts. Removal now deletes their project memberships across every project in the workspace and their team memberships across every team, in one all-or-nothing step with the workspace membership itself. Separately, a project membership no longer grants anything on its own unless the person is still in the workspace, so a row left behind by an earlier removal stops conferring access too. Memberships in other workspaces are untouched, and the response is unchanged.
- **An admin can no longer remove or demote another admin.** Both actions checked only that the caller was an owner or an admin, so any admin could strip any other — including the one who appointed them. Changing a role and removing a member now require the caller to outrank the target: the owner manages everyone, an admin manages members, and nobody may act on a peer or on themselves. Each refusal names the rule that stopped it rather than failing generically. Both actions are also pinned to the role they were authorized against, so if the target's role changes between the page loading and the action being submitted the write is refused with `409` and a message asking the admin to look again, rather than being applied to a member nobody checked.
- **Deleting your own comment now requires access to the project it is in.** Authorization was resolved only for people deleting someone else's comment; the author's own path skipped the check entirely, so somebody removed from a project could still delete comments they had written there — a write, which also updates the parent task for everyone still working on it. Access is now resolved for every caller before authorship is considered at all: an author needs any level of access, and deleting someone else's comment still requires project admin. Authorship records who wrote something; it says nothing about who may still act on the project today.
- **Marking notifications read and managing files require write scopes too.** The entry above names `task:read` for the notification inbox; the actions on it — marking one read, marking all read, and deleting one — also require `task:write`, because they change stored state rather than report it. On the file endpoints, uploading an avatar and deleting an upload require `attachment:write`, and downloading requires `attachment:read` for every file including avatars. **This affects tokens that already exist**: one minted to read notifications and tick them off needs `task:write` alongside `task:read`, since `read:*` and `write:*` each cover only their own half.
- **Invitation creation is rate limited.** Now that creating an invitation actually sends mail to an address of the sender's choosing, an unlimited endpoint was a way to send bulk mail from this deployment's domain, and a blocklisted sending domain outlives the session that caused it. Owners and admins may create 20 invitations per hour — comfortably enough to onboard a whole team in one sitting — counted per person, so one admin's bulk onboarding never eats into anyone else's allowance.

### Fixed

- **Changing a member's role and removing a member now work.** Both actions on the workspace members page addressed the wrong identifier — the membership record rather than the person — so the server correctly reported that no such member existed and the action failed every time, for everyone, since the page shipped. Both now address the member.
- **A failed removal explains itself.** The members page showed a single "Failed to remove member." message whatever the reason. It now shows the server's own explanation — for example that only the workspace owner can remove an admin, or that the member's role changed while the dialog was open and the removal was not applied — so the next step is clear instead of being another identical attempt.
- **The members list only offers actions the viewer can carry out.** Role and removal controls now follow the same seniority rules the server applies: the owner manages everyone, an admin manages members, and the Admin role can be granted only by the owner. Previously an admin was offered controls on their own row and on other admins' rows, all of which were refused on submit. Nothing is hidden from the owner.
- **The invite dialog offers only the roles you can actually grant.** The Admin role can be granted only by the workspace owner, and the members list already followed that rule — but the invite dialog still listed Admin for everyone, so an admin could pick it and the invitation was refused on submit every time. Admins are now offered Member only; the owner still sees both. This is the same rule from the same place as the members list, so the two cannot drift apart.
- **Project settings no longer claims you lack permission while it is still working out whether you do.** Opening project settings directly — from a bookmark, a shared link or a page refresh — could show "You do not have permission to manage project settings" for a moment before the page appeared, for anyone who is a project admin without also being a workspace admin. The page was reading "we do not know yet" as "no". It now waits for the answer.
- **The remove-member confirmation identifies the member by email as well as name.** Display names are not unique, and removing the wrong person deletes their project and team access outright.
- **Keyboard navigation works in the members row menus.** Arrow keys and type-ahead in the "..." menu were registered against the wrong positions for every row but the first, so opening a menu with the keyboard focused nothing. Fixed on both the workspace members page and a project's Members tab, which carried the same defect.
- **An invitation addressed with capital letters no longer strands the person invited.** Inviting `Alice@Example.com` used to store the address exactly as typed, while accounts are stored in lower case. The invitee therefore saw an empty pending-invitations list, received no in-app notification, and was left with the emailed link as their only way in — with nothing anywhere reporting a problem, because the invitation looked perfectly healthy to the admin who sent it. Invited addresses are now trimmed and lower-cased when the invitation is created, every place that compares an invited address with an account address does so the same way, and existing invitations have been converted. Where that conversion revealed two live invitations to the same person in one workspace, the more recent one is kept and the older is marked revoked.
- **Two people accepting the same invitation at once now get a clear answer instead of a server error.** Accepting used to check the invitation's status and then write, so simultaneous attempts both passed the check and the loser failed with a `500`. The membership and the invitation's status are now written in a single transaction, so either someone joins and the invitation is spent, or nothing happens at all and they can simply try again. Whoever loses the race receives `409` with the same message as accepting an invitation that was already used or revoked. Accepting an invitation to a workspace you are already in answers `400` and leaves the invitation untouched rather than consuming it.
- **Invitations are now emailed to the person invited.** Creating an invitation sent no mail at all: someone who already had an account received an in-app notification, and someone who did not — the ordinary case when adding a new colleague — received nothing, with nothing anywhere reporting a problem to the admin who sent it. Every invitee is now emailed a link, account or no account. The mail goes out after the invitation is recorded, so a mail provider that is down or unconfigured logs the failure and leaves the invitation intact rather than turning it into an error the admin would retry into the duplicate-pending guard; a deployment with no mail provider configured prints the link to the server log rather than discarding it.
- **Invitation emails are sent even when `EMAIL_FROM` is not configured.** Password-reset and verification mail applied a default sender; the invitation path did not, so a deployment with a mail provider configured but no sender address had every invitation rejected by the provider, with the failure recorded only in the logs — while other mail kept working, making it look as though mail was fine. Every outbound email now resolves its sender in one place, including the API-token and webhook notices, and a blank or whitespace-only setting is treated the same as an unset one — including by the start-up warning, which previously stayed silent on a whitespace-only value and so was quiet in exactly the case hardest to spot by eye.
- **Pending invitations have a Copy link control.** Mail bounces, lands in spam, or is never sent at all on a deployment with no mail provider configured, and until now that left an admin with no way to get the link to the person they had invited. The workspace members page now fetches the link on demand for any pending invitation and copies it to the clipboard, falling back to a selectable field where the browser refuses clipboard access. It is fetched when asked for rather than carried in the invitations list, so the link comes to rest in as few places as possible. The backing endpoint is `GET /api/workspaces/:workspaceId/invitations/:id/link`, open to owners and admins on a browser session, and it declines to hand out a link for an invitation that has been revoked, accepted or expired.
- **Four more workspace actions explain themselves when they fail.** Changing a member's role, revoking an invitation and copying an invite link each showed one fixed message whatever the reason, and accepting an invitation showed nothing at all — the button simply re-enabled. Each now shows the server's own explanation, so an invitation that was revoked, has expired, or was addressed to a different account says so.
- **Guest pages no longer lose what they are showing when the browser re-checks the session.** That check runs on window focus, on tab visibility, and after any sign-in or sign-up call, and while it was in flight the sign-in, register, forgot-password and reset-password pages — and the landing page — were replaced by a full-screen spinner and rebuilt afterwards. The most visible casualty was registration: creating an account triggers a re-check, which wiped the "check your email" confirmation the page had just shown and left a blank form with no sign the account existed. The spinner now appears only while the session is genuinely unknown, which is the first check after the page opens.
- **Completing a repeating task no longer fails when someone else is adding work to the same column.** The next occurrence is placed at the end of its task group, and the slot it was given could be taken by another task created, moved, duplicated or imported in the same instant — which failed the completion outright. The placement is now retried against a fresh position. Relatedly, a completion that could not find the occurrence it had just created used to return quietly as though the series had simply ended; it now retries, and reports the failure if it cannot, because a repeating task that stops on its own is the one outcome nobody notices.
- **Completing a repeating task twice at the same instant no longer fails.** When two requests to complete the same repeating task arrive together — a double-click, or a client retrying a request it never saw the answer to — one of them creates the next occurrence and the other is supposed to notice that it already exists and return the same result. That recognition never worked, so the second request answered `500` for work that had in fact succeeded, and clients that retry on server errors kept trying. Both requests now succeed, and exactly one next occurrence is created.

### Changed

- **Signing up now requires you to verify your email address before you can sign in.** Registration no longer creates a session; it sends a verification link and the page says so. Following that link signs you in and returns you where you were headed, which is what lets someone invited by email register, verify and land back on their invitation. Signing in before verifying is refused and sends a fresh link, because the original expires and there would otherwise be no way to ask for another. This is what makes an email address evidence of who someone is rather than of what they typed into a form — workspace invitations are authorized by matching the invited address against the account's own. **Existing accounts are unaffected**: `migrations/0035_backfill_email_verified.sql` marks every account created before this release as verified, because the product never asked those people to prove anything. **That migration must be applied with the deploy.** It changes no schema, so it is easy to mistake for backend-only code, and `bun run deploy` does not apply migrations — run `bun run db:migrate:remote` every time. It does nothing when there is nothing pending, and skipping it leaves the requirement in force with nobody grandfathered.
- **Signing in returns you to the page you were trying to reach.** An invitation link opened while signed out sends you to sign in or register, and that used to end on the dashboard — leaving the invitee to dig the link back out of their email before they could accept. Sign-in and email verification now return to the page that sent you there. Only destinations inside the app are followed; anything that resolves elsewhere is ignored and you arrive at the dashboard as before.
- **Registration no longer asks you to accept the Terms of Service.** Because signing up now requires email verification before a session exists, an acceptance ticked on the registration form could not be recorded, and users were asked to accept a second time on their first sign-in. Registration links the Terms and Privacy Policy and says when you will be asked; the single recorded acceptance happens once you sign in.

## [1.28.1] - 2026-06-26

### Fixed

- **A confirmation dialog opened over a click-to-dismiss panel no longer closes the panel beneath it.** Modal dialogs (e.g. a task's delete-confirmation) open in the browser's top layer and are mounted outside the panel they overlay, so clicking inside the dialog was read as a click "outside" the panel and dismissed the panel out from under its own dialog. Clicks inside an enclosing open dialog are now ignored by the panel's outside-click handler — unless the dialog itself wraps the panel (e.g. a dropdown inside a form dialog), where clicking elsewhere in the dialog still closes the dropdown as before.
- **Removed doubled inner padding from confirmation and settings dialogs.** Several dialogs nested their content in an extra padded container on top of the padding the base dialog already applies, leaving the content inset further than intended; the redundant inner padding has been removed so spacing is consistent across dialogs.

## [1.28.0] - 2026-06-21

### Added

- **Reorder tasks within a column without dragging.** A task's actions menu on the Board now offers **Move up** and **Move down**, shifting the task one slot within its column and disabling at the top/bottom edges. This is the non-drag fallback for reordering — primarily for touch, where a press-and-hold drag can be fiddly — and produces exactly the same ordering a single-slot drag would, so the menu and drag stay consistent. The new position is computed against the full column order (not just the cards visible under the per-column display cap), so a card at the visible/hidden boundary still moves correctly.

### Fixed

- **Drag-to-reorder now works reliably on touch devices.** Board cards/columns, the sidebar project list, and subtask lists previously used a single pointer-based drag sensor with a small movement threshold, which on phones lost the gesture to native scrolling before a drag could start — so reordering by drag was effectively impossible on mobile. Drag activation now uses separate mouse and touch models: mouse drags still begin after a 5px move, while touch uses press-and-hold so a single finger can both scroll a column (quick swipe) and reorder (hold, then drag) without breaking finger-scrolling. Tapping a card's chips, checkbox, menu, or a column's colour dot still performs its own action and no longer risks starting a drag.

## [1.26.0] - 2026-06-13

### Added

- **Rich markdown in task descriptions and comments.** Task descriptions and comments now render lite markdown — headings, bold/italic, bulleted and numbered lists, blockquotes, links, inline code, fenced code blocks, horizontal rules, and `@mentions`. Descriptions gain a click-to-edit field with a formatting toolbar, Write/Preview tabs, and keyboard shortcuts (⌘/Ctrl+B bold, I italic, E inline code, K link; Enter continues a list); editing is committed explicitly via Save / Cancel (⌘/Ctrl+Enter saves, Esc cancels), so clicking away never discards an in-progress edit. Anything that isn't part of the supported set degrades gracefully to plain text, and what you store is still a plain markdown string — so existing descriptions and comments, webhook payloads, and exported data are unaffected. Links are restricted to safe `http`/`https`/`mailto` targets.

## [1.25.0] - 2026-06-13

### Changed

- **Start dates are now independently optional and always visible.** The task panel's Start date and Due date rows are both shown at all times (Start above Due), matching every other property row instead of hiding the start date behind the old "+ Add start date" affordance — so the available date fields are legible at a glance, including for tasks created start-first. A task can now carry a **start date with no due date** ("work that begins on a day with no deadline"), a due date alone, both (a start → due range), or neither. The server enforces only the ordering rule — start ≤ due, and only when both are present — so a start date no longer requires a due date. Each row has its own clear (×) button that clears just that field: clearing the due date now leaves a surviving start date in place (previously it silently cleared the start date too, which was correct only while a start date required a due date).
- **The personal ICS calendar feed and the in-app project `.ics` export now include start-only tasks.** A task with a start date but no due date was previously dropped from both; it now appears as a single all-day event on its start date. The feed orders events by the day each one sits on (due date, or start date when there is no due date).
- **Recurring start-only tasks advance their start date.** When a recurring task has a start date but no due date, completing it spawns the next instance by advancing the **start** date and leaving the due date null — a start-only series never silently grows a due date. Ranged (start + due) and due-only recurrences are unchanged.

### API

- `POST /api/projects/:projectId/tasks`, `PATCH /api/tasks/:taskId`, and `POST /api/projects/:projectId/tasks/import` now accept a `startDate` without a `dueDate`. The only cross-field validation is `startDate` ≤ `dueDate` when **both** are present (`"Start date must be on or before the due date"`, 400). The `"Start date requires a due date"` 400 is removed. `PATCH {dueDate: null}` no longer auto-clears a stored `startDate`. No database migration — the `startDate` / `dueDate` columns were already nullable; only the shared Zod validation and the `updateTask` merged-state backstop changed.

## [1.24.1] - 2026-06-13

### Fixed

- **Start date / Due date rows in the task panel are now visually and functionally symmetric.** The two rows previously laid out differently — the Start row's input shared its width with a trailing clear (×) button while the Due row's input spanned the full column — so the native calendar icons and right edges of the two rows visibly misaligned. Both rows now share one layout contract (a flex row of input + a permanently reserved 24px clear slot, rendered invisibly when there is nothing to clear), so the inputs stay pixel-identical in every state. The Due date row also gains its own clear (×) button — native date inputs have no reliable cross-browser clear affordance, so a due date was effectively un-clearable from the panel. Because the server rejects a start date without a due date, clearing the due date clears the start date with it in a **single** patch (never a transient start-without-due state). The × itself was promoted from a floating 14px glyph to a proper 24px icon button with a hover surface, and an empty, just-revealed Start row can now be collapsed via its × (previously the button only appeared once a value existed, so an empty row had no off switch — and collapsing it issues no pointless server write).

## [1.24.0] - 2026-06-12

### Added

- **Clear view** — the Views menu on the Board, List, and Timeline tabs gains a "Clear view" action whenever a saved view is active. One click releases the board back to its default, unfiltered state: the view selection and every filter/grouping param it carried are dropped in a single navigation, while unrelated URL state (such as an open task panel) is preserved. Previously a view's row behaved like a radio group with no off state — the only ways out of a view were editing it, deleting it, or hand-clearing the URL.

### Fixed

- **Workspace export → import failed for Unsplash covers picked before `rawUrl` existed.** The `rawUrl` field was added to the Unsplash cover payload after the `cover_unsplash` column shipped, so covers chosen before then are stored without it. Export emitted those rows verbatim, but the import schema reused the strict apply-endpoint schema (which requires `rawUrl`), so the very document an export produced could not be imported back — making export/import unusable for any workspace with a pre-`rawUrl` cover. Stored/read/round-trip paths (DB column types, API response schemas, export/import schemas) now use a lenient variant with optional `rawUrl`, while the strict schema still guards the cover-apply endpoints so every newly picked cover remains full-fidelity. Legacy covers round-trip intact and continue to render via the existing pre-baked URL fallback.

## [1.23.0] - 2026-06-12

### Added

- **Workspace data export & import** — a new **Data** tab in Workspace Settings (owner/admin) that makes the "your data is never held hostage" promise real in-product. See the [Export & Import guide](docs/guides/export-import.md).
  - **Export a workspace to JSON.** Download one canonical, versioned archive of the whole workspace — every project with its task groups, labels, tasks, subtasks, comments, and attachment manifests, plus a `users` directory that resolves even ex-members so the file never loses the answer to "who did this work?". The server streams the document one project at a time, so even large workspaces export in a single request with no job queue. An opt-in toggle adds each task's activity history. Owner/admin only, 5/hour.
  - **Import a Cadence export or a Trello board.** Upload a Cadence workspace export or a Trello board's JSON export (the format is auto-detected) to create those projects as **new** projects in the current workspace — import never merges into or mutates existing content. People are matched by email against current workspace members; unmatched users import their tasks unassigned and are listed in the report rather than silently dropped. Each project imports all-or-nothing: a failure rolls that project back fully while the rest still import. Owner/admin only, 10/hour, files up to 20 MB.
  - **Dry-run preview before every import.** The Data tab always previews first — detected format, per-entity counts, unmatched users, and an honest ledger of what is skipped (workspace config, webhooks, teams, invitations, attachment binaries, activity history) — then commits the same file on confirm.
  - **Export a project's tasks to CSV** from Project Settings — a flat, spreadsheet-friendly file (one row per task) available to any project member, hardened against CSV formula injection. 30/hour.
  - Every export and every import commit is recorded in the workspace audit log.

## [1.22.0] - 2026-06-12

### Added

- **Calendar view** for projects — a fifth project tab beside Board, List, Timeline, and Dashboard. A Monday-start month grid places each task on its due date; a task with a start date renders as a bar spanning start → due. Page between months with the header arrows or jump back to today, with the active month stored in the URL (`?month=YYYY-MM`) for reload-safe, shareable links. Days with more tasks than fit surface a "+N more" overflow popover, and the shared project filter bar applies so the calendar reflects whatever filters are active. Malformed `month` params degrade to the current month rather than erroring.
- **Task start dates.** Tasks can now carry an optional start date alongside the due date, forming a date range (`startDate` requires a `dueDate` and must fall on or before it). The task detail panel gains a quiet "+ Add start date" affordance that reveals an autofocused date input on demand and collapses again via a clear (×) control, so the property only appears when used. Start/due ranges drive the multi-day bars in the calendar and timeline views.
- **Recurring tasks preserve the start→due offset.** When a recurring task is completed and its next instance is spawned, the new instance's start date is shifted to keep the same gap before the new due date; a recurring task with no due date keeps a null start date.
- **Personal ICS calendar feeds.** Each user can mint a private, per-workspace subscription URL from **Settings → Calendar Feed** and subscribe to the tasks assigned to them in that workspace from Google Calendar, Apple Calendar, or Outlook. The feed lists open tasks with a due date plus tasks completed in the last 30 days (marked `STATUS:COMPLETED` so a checked-off task stays visible instead of vanishing), capped at 500 events, and carries only the task title and a link back into the app. `GET` / `POST` / `DELETE /api/workspaces/:workspaceId/calendar-feed` manage the feed (status, mint/regenerate, revoke); the public `GET /api/calendar/feed/:token` serves the `text/calendar` body.
- **Bulk calendar import API.** `POST /api/projects/:projectId/tasks/import` creates up to 500 tasks in one request from a client-parsed `.ics` calendar — the server only ever accepts validated JSON, never the raw file. Imported tasks are appended to the target task group in payload order. Events carrying a `sourceUid` (the ICS `UID`) are deduplicated per project, so re-importing the same file reports already-imported events as `skipped` instead of duplicating them; events without a UID are created on every import. All inserts run in a single atomic D1 batch, the endpoint is rate-limited to 10 requests/minute, and bulk imports deliberately dispatch no `task.created` webhooks (a 500-event import would otherwise flood subscribers).
- **In-app calendar export and import.** A calendar menu beside the project view tabs (hidden on the Settings and Dashboard tabs) moves tasks between Cadence and any `.ics` file. **Export calendar (.ics)** — available to anyone who can see the project — downloads the whole project as a `.ics` generated entirely in the browser from the tasks already in memory (no export endpoint): every task with a due date becomes an all-day event, tasks with a start date span start → due, and titles, descriptions, and completion status (`STATUS:COMPLETED`) are included. It exports the **entire project**, not the currently filtered subset, so the file never silently depends on invisible filter state; a project with no dated tasks is explained rather than handed an empty file. **Import calendar (.ics)…** — shown only to members who can edit tasks — opens a dialog that parses a chosen file client-side (so the raw file never reaches the Worker), previews the events found and flags any that couldn't be read, lets you pick the target task group, and creates the tasks via the bulk-import endpoint. The dialog enforces a 1 MB file cap and the endpoint's 500-task limit up front, and surfaces the UID-dedupe behavior in its copy so re-imports that skip already-created events are never a surprise.
- `sourceUid` on the task object across the API and webhook payloads — the provenance UID of the calendar event a task was imported from (`null` for tasks created any other way). It is set once at import and is immutable: `PATCH` ignores it, duplicate/move/recurrence-spawn never copy it, and it never appears in `task.updated` change sets.
- Shared RFC 5545 iCalendar generator and parser (`src/shared/lib/ics.ts`, `src/shared/lib/ics-parse.ts`): all-day floating `VALUE=DATE` events with exclusive `DTEND`, CRLF/LF tolerance, line unfolding, property-parameter stripping, text un/escaping, and `DURATION` support. Stable per-task UIDs (`task-<id>@cadence`) let subscription clients update events in place across fetches rather than duplicating them.
- Database migrations `0032_faulty_odin` (nullable `startDate` on `task`), `0033_brown_chameleon` (the `calendar_feed_token` table — one feed per user per workspace), and `0034_far_mystique` (`source_uid` on `task` plus a **partial** unique index on (`projectId`, `source_uid`) backing import dedupe; partial so the majority of non-imported tasks never collide on `NULL`).

### Security

- Calendar feed URLs are capability URLs in a separate, read-only `cdn_cal_` credential class — distinct from Personal Access Tokens. The URL is returned exactly once at mint time; the server stores only an HMAC-SHA256 hash, so a lost URL can only be recovered by regenerating (which atomically kills the old one). The public feed endpoint verifies in constant shape — cheap prefix reject, peppered hash lookup, then a live workspace-membership re-check so removing a user from the workspace kills their feed on the next fetch — and returns an identical `404` for every failure mode (bad prefix, unknown token, revoked membership), leaking no oracle for enumerating live feeds. Feeds never include task descriptions, only titles, so third-party calendar storage receives no task bodies. The feed-management surface is cookie-session only: PAT callers are rejected, so a leaked API token cannot mint a second, independently-revocable credential class for its user.
- The bulk-import endpoint reuses the exact task validation contract as single-task create (title/description/date rules and the start ≤ due refinement), so an import can never write values a hand-created task couldn't. The target task group is re-checked to belong to the project in the URL, preventing cross-project task injection.

## [1.21.0] - 2026-06-12

### Added

- **Saved Views** for project boards. The current board/list/timeline filter and grouping state can be saved as a private, named view and re-applied in one click. The filter bar gains a **Views** pill — it shows the active view's name plus a muted "· Edited" indicator when the live filters have drifted from the saved snapshot — and an inline naming flow with no modals or settings page. From the pill menu you can apply, rename, or delete a view, update the active view to match the current filters, or save the current filters as a new view. Before any view exists, a quiet "Save view" affordance appears beside **Clear filters** once there are filters worth saving; until then the bar is pixel-identical to before. Applying a view writes its full state (including a `view=<id>` param) to the URL, so a saved view is reload-safe and shareable.
- `GET` / `POST` / `PATCH` / `DELETE /api/projects/:projectId/views` endpoints for per-user saved-view CRUD. Each view stores a `{ tab, params }` snapshot of the board's URL state: `tab` is a bounded string (≤20 chars, not an enum) and `params` is a bounded **open** string-record (≤16 entries, keys 1–40 chars, values ≤500 chars) so a view authored by a newer client round-trips through an older server without dropping params it doesn't recognise. Names are 1–50 chars (trimmed) and unique per project + user case-insensitively (409 on collision); maximum 20 views per project per user (400 over the cap). Cap, duplicate-name, and last-position lookups run in a single batched round-trip.
- `useSavedViews`, `useCreateSavedView`, `useUpdateSavedView`, and `useDeleteSavedView` web hooks, plus a per-project saved-views query key. Create is non-optimistic (it must navigate to the server-assigned view id); update and delete are optimistic with rollback. List-only caching, no freshness signaling.
- View-state utilities (`src/web/lib/view-state.ts`): capture the active tab and filter params from the URL, serialise a view back into a single canonical query string (the stored `view` key is dropped to avoid double-param shadowing), and compare two states order-insensitively (comma-list values are set-compared and absent-vs-empty is normalised) so the "Edited" indicator cannot false-positive.
- Database migration `0031_workable_wraith.sql` adds the `saved_view` table: per-user, per-project named view snapshots with fractional `position` ordering, `ON DELETE CASCADE` on both the project and the creating user, and a unique index on name per (project, creator).

### Security

- Saved views are strictly private per user. Every saved-view query is scoped by both `projectId` **and** the caller's id, so another member's — or a non-existent — view id is indistinguishable from missing: update and delete return **404, never 403**, meaning a member cannot read, modify, or even confirm the existence of another user's views by guessing ids. Saved-view writes also deliberately never bump `project.updatedAt`, so a private bookmark never churns the whole team's freshness polling.

## [1.20.0] - 2026-06-12

### Added

- Workspace-level filtering on the **My Tasks** page. The filter bar now offers the same Priority, Due date, and Label popovers as the in-project board, alongside the existing Project and Task group filters. Due date supports a date range plus a "No due date" toggle; labels are deduplicated by name across every active project the user can see, plus a "No label" toggle. Range/absence pairs combine inclusively (in range **or** no due date; selected labels **or** no label). All dimensions are applied server-side so counts stay accurate across pagination, render as removable chips (including dedicated "No due date" / "No label" chips), clear together via "Clear filters", and persist in the URL for reload-safe, shareable links.
- `GET /api/workspaces/:workspaceId/labels` endpoint returning labels across every active project the caller can see, deduplicated by case-insensitive name (one `{ name, color }` per group). Backs workspace-level label filter UIs where a label's cross-project identity is its name rather than a project-scoped id. Respects per-member project visibility: owners/admins see labels from all workspace projects, other members only from projects they belong to.
- `priority`, `dueDateFrom`, `dueDateTo`, `noDueDate`, `labelNames`, and `noLabel` query parameters on `GET /api/workspaces/:workspaceId/dashboard/my-tasks` for server-side filtering. Due-date bounds are strict `YYYY-MM-DD` calendar dates validated calendar-aware (impossible dates such as `2030-02-30` rejected with 400); `labelNames` is a CSV of label names (each 1–30 chars, max 50) matched case-insensitively across projects.
- `useWorkspaceLabels` web hook wrapping the workspace labels endpoint, plus a `queryKeys.workspaces.labels` query key. The My Tasks query key gained a normalized `filters` object segment so each filter combination caches independently while prefix invalidation still covers every combination.
- Timeline view can now **group by label**: a task with multiple labels appears under each of its labels, and tasks with none fall into a trailing "No label" group.

### Fixed

- Removing the date-range chip now clears both `dueDateFrom` and `dueDateTo` in a single update. Previously two back-to-back single-key writes both started from the same render-time URL params, so the second write resurrected the bound the first had deleted and left a half-active range.
- Opening or closing a task from a card or the add-task form now preserves the active filter params instead of wiping the rest of the query string.

## [1.17.0] - 2026-04-21

### Added

- Unsplash cover-photo integration scaffolding: optional `UNSPLASH_ACCESS_KEY` / `UNSPLASH_SECRET_KEY` / `UNSPLASH_APP_NAME` env bindings, shared Zod schemas (search input, curated input, `UnsplashCoverPayload`, paginated response), and `coverUnsplash` columns on `project` and `task` (mutually exclusive with `coverImageKey`).
- `GET /api/unsplash/search` and `GET /api/unsplash/curated` proxy endpoints. Both require auth and share a 30 req/min per-user rate limit. Responses are normalised into `UnsplashCoverPayload` and carry mandatory `utm_source` / `utm_medium=referral` attribution on every user-visible outbound link.
- `GET /api/config` unauthenticated endpoint returning runtime feature flags (currently `features.unsplash`). Sent with `Cache-Control: private, max-age=300` so SPA navigation does not re-fetch but shared caches never store it. Lets the web client hide the Unsplash tab in the cover picker when the integration is not configured server-side.
- `createUnsplashService` factory that returns `null` when `UNSPLASH_ACCESS_KEY` is unset (callers return 503), encapsulates the 8-second request timeout and `Authorization: Client-ID` header, normalises raw Unsplash payloads, and exposes a `trackDownload` method that is safe to call via `waitUntil` (swallows all errors).
- `PUT /api/projects/:projectId/cover/unsplash` and `PUT /api/tasks/:taskId/cover/unsplash` endpoints apply an `UnsplashCoverPayload` as the entity's cover image. Both are rate-limited to 10 req/min, validate the payload against `unsplashCoverPayloadSchema`, atomically flip `coverUnsplash` and `coverImageKey` to preserve the XOR invariant, clean up any prior R2 cover artifact after the DB write succeeds, and fire the Unsplash download-tracking GET via `deferWork`.
- Web cover hooks (`useProjectCover`, `useTaskCover`) now expose `handleApplyUnsplash` / `handleCoverApplyUnsplash` and mirror the `coverImageKey` ↔ `coverUnsplash` XOR invariant in every optimistic path (upload clears any Unsplash payload, apply clears the key, remove clears both). Both hooks route through a shared `resolveCoverDisplay` helper that returns a `{ coverUrl, coverAttribution }` bundle (`name`, `username`, `profileUrl`, `photoUrl`) for the required "Photo by X on Unsplash" credit. `useTaskCover` now accepts `coverImageKey` / `coverUnsplash` options so it can derive the same values as `useProjectCover` instead of callers recomputing the URL inline.
- Cover banner (`CoverImage`) now delegates "Add cover" / "Change cover" to `CoverImagePicker` so the upload and Unsplash flows share a single entry point, and overlays the required photographer credit chip ("Photo by X on Unsplash") whenever a Unsplash cover is active. Attribution links open in a new tab with `rel="noopener noreferrer"`, UTM params are baked in server-side (never re-appended client-side), and the chip is suppressed during reposition/upload to avoid clashing with overlay UI. The chip stays mounted in the DOM (required by the Unsplash guidelines) but fades in on hover/focus-within so it doesn't dominate the cover — keyboard users still reveal it via the focus-within ring on the attribution links.
- Context-appropriate Unsplash renditions via new shared helper `src/shared/lib/unsplash-display.ts`. `UnsplashCoverPayload` gains a required `rawUrl` (the imgix source URL from `photo.urls.raw`); the web client composes cover-sized (`w=1600&q=80&auto=format&fit=max`) and card-sized (`w=500&q=75`) URLs from it instead of always hotlinking the fixed 1080px `regular` rendition. `useProjectCover` / `useTaskCover` additionally expose a `coverSrcSet` string (800/1600/2400w) that the cover `<img>` renders with `sizes="100vw"` so the browser picks the smallest rendition that satisfies the display. Legacy rows written before `rawUrl` existed transparently fall back to the pre-baked `url`/`thumbUrl`.
- Cover banner gains a mobile-first tap-to-open affordance and a confirmation-gated remove. Tapping anywhere on an existing cover (outside inline action buttons) opens the picker — touch users can't hover to reveal the action row, so the container click is now the primary mobile entry point. The Remove action opens a `ConfirmDialog` rather than firing inline; action chips are `pointer-events-none` until hover/focus-within so a tap that lands under an invisible button can no longer nuke the cover instantly.
- New `useFeatures` hook wraps `GET /api/config` with aggressive caching (5-minute stale window, no refetch-on-focus) so gating UI for optional integrations stays cheap.
- New `useUnsplashSearch` hook: infinite-query wrapper for the cover picker that transparently switches between the curated and search endpoints based on the debounced query, embeds orientation in the query key, and disables retries so 429/503 surface immediately without burning the shared per-user quota.
- New `CoverImagePicker` modal component unifies the Upload and Unsplash flows: a widened native `<dialog>` with a compound `<Tabs>` primitive, a drag-and-drop upload panel reusing `useFileUpload` / `optimizeImage(COVER_PRESET)`, and an Unsplash panel with debounced search, orientation filter, infinite-scroll via `IntersectionObserver`, `blur_hash`/`color` LQIP placeholders, and photographer chips on every card. The Unsplash tab and its query are gated on `useFeatures().unsplash` so users who never enable the feature never hit `/api/unsplash/*`.
- Mirror-to-public workflow (`.github/workflows/mirror-to-public.yml`) secret-scan regex extended to flag `UNSPLASH_ACCESS_KEY=<value>` / `UNSPLASH_SECRET_KEY=<value>` assignments before pushing to the public mirror. Unsplash keys are prefix-less 43-char base64url, so detecting the assignment form catches the realistic leak vector without flagging the legal `UNSPLASH_ACCESS_KEY?:` type declaration.
- Database migration `0027_add_cover_unsplash.sql` adds the nullable `cover_unsplash` TEXT (JSON) column to `project` and `task`. Safe on existing rows (no default / backfill).

### Changed

- Upstream Unsplash errors are never echoed to clients. `429` is surfaced verbatim so clients can back off; all other upstream failures are remapped to `502` with `{ upstreamStatus }` and the response body is logged server-side only.
- Shared `handleUploadCover` / `handleApplyUnsplashCover` / `handleDeleteCover` helpers in `src/api/lib/cover-image.ts` now enforce the `coverImageKey` ↔ `coverUnsplash` XOR invariant in application code: every write funnels through a single `setEntityCover(db, { coverImageKey, coverUnsplash }, updatedAt)` callback that always writes BOTH fields so one source clears the other atomically. `PUT /cover` upload responses now include both cover fields, and `DELETE /cover` clears both and only requires the R2 storage binding when an R2 cover actually exists.

## [1.16.2] - 2026-04-18

### Fixed

- Toggling a task's completion state now refreshes the workspace dashboard and the workspace/project/task activity feeds. Previously only the task detail, comments, project dashboard, and the My Tasks dashboard slice were invalidated, leaving other views stale until a manual refetch.

## [1.16.1] - 2026-04-17

### Fixed

- Concurrent creates of task groups, tasks, and subtasks no longer produce duplicate fractional-index `position` values. The previous "read last position, compute next, insert" sequence was non-atomic, so burst requests (multi-tab, rapid form submits) could leave ties that destabilized `ORDER BY position` and made drag-reorder appear to move unrelated rows in lockstep.

### Changed

- Added `UNIQUE(parentId, position)` indexes on `task_group` (per `projectId`), `task` (per `taskGroupId`), and `subtask` (per `taskId`). Migration 0026 first rewrites every partition's positions to fixed-width `a00001`, `a00002`, … keys before adding the indexes so existing ties are broken deterministically by `(position, id)`.
- Task-group, task, subtask, task-duplicate, and complete/uncomplete handlers now wrap their position read + write in a retry helper (`retryOnPositionConflict`) that re-reads the boundary position and retries on UNIQUE-violation. Non-UNIQUE errors propagate unchanged.
- List queries for task groups, tasks, and subtasks now sort by `(position, id)` so any transient duplicate during optimistic UI updates resolves to the same stable order on both client and server. A shared `sortByPosition` helper applies the same tiebreaker in the web app.
- Removed dead client-side position computation in `AddGroupColumn` and `AddTaskInline`. The server has always assigned position on these endpoints (the submitted field was silently stripped by the request schema); the client now relies on the authoritative server value.

## [1.16.0] - 2026-04-13

### Added

- My Tasks page now supports filtering by project and task group via a filter bar with multi-select popovers and removable chips
- `GET /api/workspaces/:workspaceId/task-groups` endpoint for listing task groups across multiple projects in a workspace
- `projectIds` and `taskGroupIds` optional query parameters on the My Tasks endpoint for server-side filtering
- `useWorkspaceProjects` and `useWorkspaceTaskGroups` shared hooks for workspace-level data fetching
- Filter selections are persisted in URL search params for shareability and reload persistence
- Auto-pruning of orphaned task-group filter selections when their parent project is deselected

## [1.14.0] - 2026-04-11

### Added

- Pluggable telemetry subsystem with three sink backends (Analytics Engine, console, noop) and per-request middleware that tracks HTTP request events
- Telemetry tracking on webhook delivery and retry attempts (duration, status, attempt count)
- Telemetry tracking on scheduled cron tasks (per-task and overall run duration, success/failure counts)
- Client-side Zod validation on webhook create/edit forms with inline field-level error display
- New `webhook_project_idx` database index on `webhook.projectId` for faster project-scoped lookups

### Changed

- Webhook `projectId` foreign key now cascades on delete (migration 0025)
- Scheduled handler reports `cron_run` and `cron_task` telemetry events for observability

## [1.13.0] - 2026-04-09

### Added

- Drag-and-drop project reordering in the workspace sidebar using fractional indexing
- `PATCH /api/projects/:projectId/reorder` endpoint for updating project position
- Lazy backfill: existing projects without a position are automatically assigned one on first list
- New projects and duplicated projects are appended to the end of the sidebar order
- Optimistic UI updates for instant drag-and-drop feedback with rollback on failure

## [1.12.1] - 2026-04-09

### Added

- Webhook payload enrichment: task events include resolved `assignee`, `taskGroup`, and `completedByUser` objects; member events include resolved `user` object; comment events include resolved `author` object
- Enriched `changes` field: `task.updated` and `task.moved` events include resolved objects for ID-based changes (e.g. `assignee: { from, to }` alongside `assigneeId: { from, to }`)
- Non-retryable HTTP status codes (401, 403, 404, 405, 410) skip retries immediately on webhook delivery failure
- Project-scoped webhook management UI in Project Settings > Webhooks tab (6 new API endpoints)
- Archiving a project now auto-deletes its project-scoped webhooks

### Changed

- Workspace webhook form only shows active projects in the project scope selector
- Shared webhook handler helpers (`MAX_WEBHOOKS_PER_WORKSPACE`, `isDevMode`, `omitSecret`) extracted to `src/api/lib/webhooks/utils.ts`
- `resolveRecurringTaskEnrichment()` extracted as shared helper for recurring task webhook payloads
- API client now handles 204 No Content responses

## [1.11.0] - 2026-04-09

### Added

- Project-scoped webhooks: optionally limit a webhook to fire only for events from a specific project
- Validation that project-scoped webhooks cannot subscribe to workspace or invitation events
- Project scope selector in webhook create/edit dialogs with automatic event filtering

## [1.10.1] - 2026-04-06

### Changed

- Webhook retry batch limit increased from 10 to 50 per cron invocation
- Webhook retry backoff delays now include ±20% random jitter to prevent thundering-herd effects
- Scheduled handler tasks are now error-isolated — a failure in one cleanup task no longer blocks the rest
- Comment database index upgraded to compound index on (`taskId`, `createdAt`) for faster chronological queries
- Structured context objects added to error logging across API handlers for improved debuggability

### Added

- Error states with retry UI on ProjectBoard and ProjectTimeline when data queries fail
- `tasksError` and `taskGroupsError` exposed from `ProjectContext` for downstream error handling
- Notifications and Workspaces pages now use the `EmptyState` component family for consistent empty-state UX

### Removed

- One-off `convert-to-oklch.ts` script (color migration complete)

## [1.10.0] - 2026-04-06

### Added

- Terms of Service and Privacy Policy pages (`/terms`, `/privacy`)
- ToS acceptance gate for authenticated users via `TosGuard` route guard — existing users who haven't accepted the current ToS version are redirected to `/accept-terms`
- Legal acceptance API endpoints (`GET /api/legal/tos-status`, `POST /api/legal/accept-tos`) with `legal_acceptance` database table
- ToS acceptance checkbox on the registration form with schema validation (`tosAccepted` field on `registerSchema`)
- Terms and Privacy links in the landing page footer

## [1.9.2] - 2026-04-06

### Changed

- Converted all color tokens from hex/rgb to OKLCH color space across base tokens, all 17 theme files, overlays, shadows, and component CSS. OKLCH provides perceptually uniform lightness and wider gamut for more predictable color mixing across themes.
- `color-mix()` functions now interpolate `in oklch` instead of `in srgb`
- Theme editor color helper (`toHex`) now uses the `culori` library to parse any CSS color format (including OKLCH) back to hex for color picker inputs

### Added

- `culori` dependency for robust CSS color parsing and conversion

## [1.9.1] - 2026-04-05

### Changed

- Converted all hardcoded `px` values to `rem` units across CSS tokens (radius, spacing, typography, motion distances, overlay blur, media), component stylesheets, and Tailwind arbitrary values in TSX components (80 files). Improves accessibility by respecting user font-size preferences.

## [1.9.0] - 2026-04-02

### Added

- OpenAPI 3.1 specification for webhook endpoints with Scalar interactive docs at `/api/docs`
- Per-endpoint rate limiting on webhook routes (read 60/min, write 20/min, test 5/min)
- Response schemas for all webhook endpoints (`src/shared/schemas/webhook-responses.ts`)

### Changed

- Webhook routes rewritten from plain Hono to `@hono/zod-openapi` for type-safe OpenAPI definitions
- Upgraded Zod from v3 to v4; updated validation types (`ZodSchema` → `ZodType`) and Zod error access (`.errors` → `.issues`)
- Exported `validationHook` from validate middleware for reuse as `OpenAPIHono` default hook
- Docs-specific CSP policy for Scalar UI paths

## [1.8.0] - 2026-04-02

### Added

- Recurring tasks system: schema, types, recurrence rule helpers, RecurrencePicker UI, task spawning on completion, and webhook payloads for recurrence events (Phases 1-5)

### Fixed

- Timeline date-bucketing timezone bug

## [1.7.1] - 2026-04-01

### Fixed

- Project dashboard overdue count now updates when a task is marked completed

### Changed

- Completed tasks are excluded from the Timeline by default

## [1.7.0] - 2026-03-31

### Added

- Multi-mode grouping for ProjectTimeline with GroupBy dropdown, URL persistence, and input validation

### Fixed

- Skip freshness polling for single-member workspaces to eliminate unnecessary network requests

## [1.6.0] - 2026-03-31

### Added

- Real-time freshness polling system with edge caching and `updatedAt` propagation

## [1.5.1] - 2026-03-31

### Changed

- Pinned all dependencies
- Viewport-constrained height for floating elements via Floating UI size middleware

## [1.5.0] - 2026-03-31

### Changed

- Updated theme palette and aesthetic tweaks

## [1.2.0] - 2026-03-30

### Added

- Project duplication feature with API endpoint, UI dialog, tests, and docs

### Fixed

- Closing task sidebar on route change no longer bounces back to board/project route
- Tab indicator and scroll state now update correctly on tab size changes

## [1.1.0] - 2026-03-30

### Added

- `autoAssignCreator` project setting to auto-assign new tasks to their creator

## [1.0.9] - 2026-03-30

### Fixed

- Centralized My Tasks query keys and fixed DataTable double scrollbar

## [1.0.8] - 2026-03-30

### Fixed

- My Tasks task dialog double scrollbar

## [1.0.7] - 2026-03-29

### Changed

- Split monolithic API handlers and utilities into modular subdirectories
- Added barrel import rule to prevent circular chunk dependencies in build

### Fixed

- Circular dependency issues in build output

## [1.0.6] - 2026-03-29

### Added

- Rate limiting on invitation lookup and acceptance endpoints
- `componentDidCatch` error boundary to force silent refresh after deploy (stale asset hashes)
- Public mirror CI pipeline for private/public repo binding

### Fixed

- UI component error handling, query hooks, and project page refactor
- UserMenu placement on `/workspaces` page
- Delete Tasks no longer produces console errors
- CSP updated for Cloudflare static insights

### Changed

- API error handling, type safety, and parameter validation refactor

## [1.0.4] - 2026-03-29

### Added

- Password reset cooldown and rate limiting

## [1.0.3] - 2026-03-28

### Fixed

- Minor bug fixes

## [1.0.1] - 2026-03-28

### Changed

- Workspace slugs are now unique per-owner (composite index) instead of globally unique

## [1.0.0] - 2026-03-28

Initial public release.

### Pre-1.0 highlights

- **Core platform**: Workspaces, projects, tasks, labels, attachments, teams, invitations
- **Task management**: Kanban board with drag-and-drop, task detail panel, bulk actions, subtasks, comments
- **Project features**: Timeline view, dashboard with stats, budget tracking, project lifecycle (active/completed/archived)
- **Auth**: Better Auth integration with email/password, session management, password hashing
- **API**: 84 endpoints with Hono, rate limiting, HMAC-signed webhooks (23 event types)
- **Performance**: D1 query batching (`db.batch()`), session cookie caching, auth singleton, cache-control middleware
- **Scheduled tasks**: Auth cleanup for expired sessions/tokens, webhook cleanup
- **Notifications**: Real-time notification system with modular components
- **Design system**: Theming, responsive layout, mobile support
- **Database**: 23 tables on Cloudflare D1 with Drizzle ORM
- **Deployment**: Cloudflare Workers

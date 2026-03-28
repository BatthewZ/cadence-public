# Onboarding System for Cadence

## Context

Cadence currently has no formal onboarding. New users land on an empty dashboard with minimal guidance — just basic empty states saying "Create your first project." For a feature-rich PM tool with kanban/list/timeline views, dashboards, cost tracking, teams, and 14 themes, users need help discovering and getting started with core workflows. This plan adds three complementary features: an onboarding checklist on the dashboard, a sample project seeded on workspace creation, and a persistent help panel accessible from any workspace page.

---

## Phase 1: Database Schema Changes

### 1a. Add `onboardingDismissedAt` to `workspaceMember`

**File:** `src/db/schema/workspace.ts`

Add nullable timestamp column to the `workspaceMember` table:
```ts
onboardingDismissedAt: integer("onboardingDismissedAt", { mode: "timestamp" })
```

Per-workspace-member so each workspace gets independent onboarding state. Stored in DB (not localStorage) so it syncs across devices.

### 1b. Add `isSample` to `project`

**File:** `src/db/schema/project.ts`

Add boolean column:
```ts
isSample: integer("isSample", { mode: "boolean" }).notNull().default(false)
```

Lets the frontend badge sample projects and lets the onboarding checklist exclude them from the "create a project" completion check.

### 1c. Generate & apply migration

```bash
bun run db:generate && bun run db:migrate:local
```

---

## Phase 2: Sample Project Seeding (Backend)

### 2a. Create `src/api/lib/sample-project.ts`

New file with `seedSampleProject(db, workspaceId, userId)` function that:

1. Creates project: name "Getting Started", icon "🎓", `isSample: true`, description explaining it's a sample
2. Creates projectMember (admin) for the user
3. Creates 3 default task groups: "To Do" (a0), "In Progress" (a1), "Done" (a2, isCompletionGroup)
4. Creates 5-6 sample tasks across groups, each teaching a feature:

   **To Do:**
   - "Explore the board view" — description about drag-and-drop, priority: none
   - "Set a due date on this task" — description about due dates/upcoming section, priority: medium, dueDate: +7 days
   - "Try assigning this task" — description about assignment/My Tasks, priority: low

   **In Progress:**
   - "Check out the project dashboard" — description about stats/charts, priority: high
   - "Invite your team" — description about workspace settings/members, priority: urgent

   **Done (auto-completed):**
   - "Create your workspace" — description congratulating them, priority: none

Uses fractional indexing for positions. No activity logging for seeded tasks (keeps the activity feed clean for real actions).

### 2b. Modify `createWorkspace` handler

**File:** `src/api/routes/workspaces/workspaces.handlers.ts` (line 41)

After the workspace and workspaceMember inserts, call `seedSampleProject(db, id, user.id)`.

### 2c. Tests

Add tests to `src/api/routes/workspaces/workspaces.handlers.test.ts` verifying:
- Workspace creation seeds a sample project with `isSample: true`
- Sample project has 3 task groups and 5-6 tasks
- Sample project has the creator as admin member

---

## Phase 3: Onboarding Checklist (Backend + Frontend)

### 3a. API: Onboarding status endpoint

**File:** `src/api/routes/dashboard/dashboard.handlers.ts`

**`GET /workspaces/:workspaceId/onboarding`** — returns:
```json
{
  "dismissed": false,
  "steps": {
    "createWorkspace": true,
    "createProject": false,
    "addTask": false,
    "inviteTeammate": false
  },
  "completedCount": 1,
  "totalCount": 4
}
```

Logic:
1. Fetch `workspaceMember.onboardingDismissedAt` for current user
2. Check if any non-sample projects exist (via `project` WHERE `isSample = false` joined with `projectMember`)
3. Check if any tasks exist in user's projects
4. Check if any invitations were sent by this user in this workspace

Middleware: `requireAuth, requireWorkspaceMember()`

### 3b. API: Dismiss onboarding endpoint

**`POST /workspaces/:workspaceId/onboarding/dismiss`**

Updates `workspaceMember.onboardingDismissedAt = new Date()`. Returns `{ ok: true }`.

Middleware: `requireAuth, requireWorkspaceMember()`

### 3c. Register routes

**File:** `src/api/routes/dashboard/dashboard.routes.ts`

Add the two new routes.

### 3d. Add query key

**File:** `src/web/lib/query-keys.ts`

```ts
onboarding: (id: string) => ["workspaces", id, "onboarding"] as const,
```

### 3e. Create OnboardingChecklist component

**File:** `src/web/pages/Dashboard/OnboardingChecklist.tsx`

- Fetches `GET /api/workspaces/:workspaceId/onboarding` via React Query
- Returns `null` if `dismissed === true`
- Renders a `Card` with:
  - Header: "Getting Started" title + dismiss (X) button
  - `ProgressBar` showing `completedCount / totalCount`
  - 4 step rows, each with: check icon (filled/empty), label, action button/link
  - When all complete: congratulatory message, auto-dismiss after 5s
- Step actions:
  - "Create workspace" — always complete, no action needed
  - "Create your first project" — opens CreateProjectDialog (pass callback from Dashboard)
  - "Add a task" — links to first non-sample project's board view
  - "Invite a teammate" — links to `/w/{slug}/settings/members`
- Dismiss calls `POST /workspaces/:workspaceId/onboarding/dismiss` with optimistic update
- Uses `refetchInterval: 30_000` for passive step completion detection

### 3f. Integrate into Dashboard

**File:** `src/web/pages/Dashboard/Dashboard.tsx` (line ~1091)

Insert `<OnboardingChecklist />` between `OverdueTasksSection` and `StatCardsRow`. Pass `onCreateProject` callback to open `CreateProjectDialog` (lift the dialog state from WorkspaceLayout or use a simpler local dialog).

### 3g. Tests

- API tests for both onboarding endpoints in `src/api/routes/dashboard/dashboard.handlers.test.ts`
- Screenshot test of the dashboard showing the checklist

---

## Phase 4: Help Panel (Frontend)

### 4a. Extract keyboard shortcuts data

**File:** `src/web/util/keyboard-shortcuts.ts` (new)

Move the `SHORTCUT_SECTIONS` data from `KeyboardShortcutsDialog.tsx` to a shared util. Update `KeyboardShortcutsDialog` to import from it.

### 4b. Create HelpPanel component

**File:** `src/web/components/ui/HelpPanel.tsx`

Slide-out panel (not a modal — doesn't block interaction):
- Fixed right edge, `w-[400px]` (full-width on mobile < 640px)
- Slide animation: `translate-x-full` -> `translate-x-0`
- `z-40` (above content, below modals)
- No backdrop on desktop; transparent backdrop on mobile
- Close on Escape via `useHotkey`
- Close on click-outside via `useClickOutside`

Content structure (using existing `Accordion` component):
1. **Getting Started** — brief intro, link to dashboard
2. **Projects** — create/manage/archive, views (board/list/timeline), link to projects page
3. **Tasks** — creating, drag-and-drop, priorities, due dates, subtasks, comments
4. **Collaboration** — inviting teammates, teams, roles, link to settings/members
5. **Keyboard Shortcuts** — render from shared `SHORTCUT_SECTIONS` data

All content is static (no API calls needed).

ARIA: `role="complementary"`, `aria-label="Help"`. Trigger button: `aria-expanded` reflects state.

### 4c. Integrate into WorkspaceLayout

**File:** `src/web/components/layout/WorkspaceLayout.tsx`

- Add `const [helpOpen, setHelpOpen] = useState(false)` state
- Add help trigger button in sidebar bottom (before `UserMenu`, line ~337):
  ```tsx
  <AppShell.SidebarSection className="mt-auto">
    <HelpPanelTrigger onClick={() => setHelpOpen(true)} />
    <UserMenu />
  </AppShell.SidebarSection>
  ```
- Render `<HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />` alongside other overlays
- Optional: `useHotkey("F1", toggleHelp)` — `?` is already taken by keyboard shortcuts dialog

### 4d. Screenshot test

Test help panel open/closed states.

---

## Phase 5: Polish & Verification

1. **Type safety:** Run `bun run typecheck` — ensure no errors
2. **Tests:** Run full test suite — fix any failures
3. **Responsive:** Screenshot test at 320px, 768px, 1024px
4. **Themes:** Verify with at least 3 themes (default, noir, one colorful like sakura)
5. **Accessibility:** Keyboard nav through checklist and help panel, screen reader test
6. **isSample in project list:** Add a subtle "Sample" badge on the project card in `ProjectList.tsx` and sidebar

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/api/lib/sample-project.ts` | `seedSampleProject()` function |
| `src/web/pages/Dashboard/OnboardingChecklist.tsx` | Dashboard onboarding widget |
| `src/web/components/ui/HelpPanel.tsx` | Slide-out help panel |
| `src/web/util/keyboard-shortcuts.ts` | Shared keyboard shortcuts data |

## Files to Modify

| File | Change |
|------|--------|
| `src/db/schema/workspace.ts` | Add `onboardingDismissedAt` column |
| `src/db/schema/project.ts` | Add `isSample` column |
| `src/api/routes/workspaces/workspaces.handlers.ts` | Call `seedSampleProject` in `createWorkspace` |
| `src/api/routes/dashboard/dashboard.handlers.ts` | Add `getOnboardingStatus`, `dismissOnboarding` handlers |
| `src/api/routes/dashboard/dashboard.routes.ts` | Register onboarding routes |
| `src/web/lib/query-keys.ts` | Add `onboarding` query key |
| `src/web/pages/Dashboard/Dashboard.tsx` | Insert `OnboardingChecklist` component |
| `src/web/components/layout/WorkspaceLayout.tsx` | Add help button + HelpPanel |
| `src/web/components/ui/KeyboardShortcutsDialog.tsx` | Import shortcuts from shared util |
| `src/web/components/ui/index.ts` | Export HelpPanel |

## Verification

1. Create a new workspace -> verify sample "Getting Started" project appears with 6 tasks
2. Dashboard shows onboarding checklist with "Create workspace" checked
3. Create a project -> checklist updates "Create project" to checked
4. Add a task -> checklist updates
5. Send an invitation -> checklist updates
6. Dismiss checklist -> disappears, survives page reload
7. Complete all steps -> congratulatory message, auto-collapses
8. Click help button -> panel slides out with accordion sections
9. Navigate between pages -> help panel accessible everywhere
10. Delete sample project -> works like any other project

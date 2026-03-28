# Web Page Test Coverage Expansion

**Rationale:** Web page test coverage is at 13% (4/31 pages tested). All API handlers have 100% test coverage, but the frontend pages — where users interact with the app — are severely undertested. This creates risk for regressions as the UX audit fixes land across many page files.

**Testing guidelines:** Read `docs/guides/tests.md` before writing tests. Key rules:
- Integration testing over mocking — test real interactions between components
- Mock only external boundaries (API client, auth hooks, context providers)
- Never use `|| true` in assertions or guard assertions with `if (isVisible)`
- Never filter out fetch/API errors
- Never add `ts-expect-error` or `eslint-disable` comments

**Testing patterns:** Follow the established patterns from existing page tests (e.g., `ProjectBoard.test.tsx`, `Notifications.test.tsx`):
- Use `vi.mock()` for API client (`api.get`, `api.post`, etc.), context hooks, auth hooks
- Polyfill browser APIs (ResizeObserver, IntersectionObserver, matchMedia) for jsdom
- Create a `createWrapper()` with QueryClientProvider (retry: false, gcTime: 0) + MemoryRouter
- Use factory functions like `makeTask()` for test data
- Use `userEvent.setup()` for interactions, `waitFor()` for async assertions
- Test: initial render, loading states, empty states, user interactions, error states, pagination

**Verification:** After each task, run `bun run typecheck` and `bun test <test-file>` to confirm tests pass.

## Dependencies

All tasks are fully independent — each page test file is self-contained and touches no shared files. All tasks can run concurrently.

## Concurrency Plan

12 pages to test, organized in 3 batches of 4 concurrent agents. Pages are grouped by complexity (smaller pages first).

---

### Batch 1 (4 concurrent agents — small/medium pages, critical user paths)

#### Task 1: Login.tsx tests (128 lines)
- **File to create:** `src/web/pages/Login/Login.test.tsx`
- **Page location:** `src/web/pages/Login/Login.tsx`
- **What to test:**
  1. Renders email and password fields, submit button, and "Register" link
  2. Shows validation errors for empty fields on submit
  3. Shows validation errors for invalid email format
  4. Calls signIn with correct credentials on valid form submit
  5. Displays server-side error messages (e.g., "Invalid credentials")
  6. Password field uses the PasswordInput component with eye toggle
  7. "Forgot password?" link navigates to forgot-password page
  8. Disables submit button / shows loading state during submission
- **Mocks needed:** `better-auth/react` (useSession, signIn), react-router (useNavigate), toast context

#### Task 2: Register.tsx tests (166 lines)
- **File to create:** `src/web/pages/Register/Register.test.tsx`
- **Page location:** `src/web/pages/Register/Register.tsx`
- **What to test:**
  1. Renders name, email, password, confirm password fields and submit button
  2. Shows validation errors for empty required fields
  3. Shows password mismatch error when passwords don't match
  4. PasswordRequirements component appears when user starts typing password
  5. Calls signUp with correct data on valid form submit
  6. Displays server-side error messages
  7. "Sign in" link navigates to login page
  8. Disables submit button during submission
- **Mocks needed:** `better-auth/react` (signUp), react-router (useNavigate), toast context

#### Task 3: MyTasks.tsx tests (339 lines)
- **File to create:** `src/web/pages/MyTasks/MyTasks.test.tsx`
- **Page location:** `src/web/pages/MyTasks/MyTasks.tsx`
- **What to test:**
  1. Renders task table with correct columns (name, status, priority, due date)
  2. Shows empty state when no tasks exist
  3. Renders task data correctly (task name, priority badge, status badge, formatted date)
  4. Filter tabs work (All, Today, This Week, Overdue) — clicking a tab filters displayed tasks
  5. Pagination / load-more works when there are many tasks
  6. Clicking a task row opens TaskDetailDialog
  7. Task count summary displays correctly
- **Mocks needed:** API client (GET tasks endpoint), WorkspaceContext, useSession, useDocumentTitle

#### Task 4: ProjectListView.tsx tests (217 lines)
- **File to create:** `src/web/pages/ProjectListView/ProjectListView.test.tsx`
- **Page location:** `src/web/pages/ProjectListView/ProjectListView.tsx`
- **What to test:**
  1. Renders DataTable with task columns (name, status, priority, due date)
  2. Shows empty state when project has no tasks
  3. Search/filter input filters displayed tasks
  4. Clicking a task row opens TaskDetailDialog
  5. Bulk action bar appears when tasks are selected
  6. Status indicators show correct visual treatment (icons/colors for Done vs Active)
- **Mocks needed:** API client, ProjectContext, WorkspaceContext, useSession

---

### Batch 2 (4 concurrent agents — medium pages, core features)

#### Task 5: ProjectList.tsx tests (368 lines)
- **File to create:** `src/web/pages/Projects/ProjectList.test.tsx`
- **Page location:** `src/web/pages/Projects/ProjectList.tsx`
- **What to test:**
  1. Renders list of project cards with name, icon, member count, task count
  2. Shows empty state when no projects exist
  3. "Create Project" button opens CreateProjectDialog
  4. Project card action menu shows correct options (Rename, Archive, Delete, etc.)
  5. Favorite toggle works — clicking star adds/removes from favorites
  6. Archive/unarchive action works through the dropdown
  7. Delete action shows confirmation dialog
  8. Search input filters projects by name
  9. Active vs archived badge styling is visually distinct
- **Mocks needed:** API client (GET/POST/PATCH/DELETE projects), WorkspaceContext, useSession, toast context

#### Task 6: Workspaces.tsx tests (459 lines)
- **File to create:** `src/web/pages/Workspaces/Workspaces.test.tsx`
- **Page location:** `src/web/pages/Workspaces/Workspaces.tsx`
- **What to test:**
  1. Renders workspace cards with name, member count, description
  2. Shows empty state when user has no workspaces
  3. "Create Workspace" button opens create dialog
  4. Create workspace form validates required fields (name, slug)
  5. Clicking a workspace card navigates to that workspace
  6. UserMenu is rendered and opens on avatar click
  7. Member count displays correctly (not "0 members")
- **Mocks needed:** API client, useSession, react-router (useNavigate), toast context

#### Task 7: WorkspaceSettings.tsx tests (299 lines)
- **File to create:** `src/web/pages/WorkspaceSettings/WorkspaceSettings.test.tsx`
- **Page location:** `src/web/pages/WorkspaceSettings/WorkspaceSettings.tsx`
- **What to test:**
  1. Renders form with workspace name, slug (read-only), description
  2. Slug field is visually read-only and not editable
  3. Form pre-populates with current workspace data
  4. Save button triggers update mutation with correct data
  5. Validation errors display for invalid input
  6. Theme grid selector renders and is interactive
  7. Success toast appears on successful save
- **Mocks needed:** API client, WorkspaceContext, useSession, toast context

#### Task 8: WorkspaceMembers.tsx tests (427 lines)
- **File to create:** `src/web/pages/WorkspaceSettings/WorkspaceMembers.test.tsx`
- **Page location:** `src/web/pages/WorkspaceSettings/WorkspaceMembers.tsx`
- **What to test:**
  1. Renders DataTable with member columns (name/avatar, email, role, joined date)
  2. Shows correct member data (names, emails, role badges)
  3. Invite member input field accepts email and triggers invitation
  4. Role change dropdown appears for non-owner members
  5. Member action dropdown shows remove option
  6. Remove member shows confirmation dialog
  7. Responsive: "Joined" column hidden on mobile viewport
  8. Empty state when workspace has no other members
- **Mocks needed:** API client (GET members, POST invite, PATCH role, DELETE member), WorkspaceContext, useSession, toast context

---

### Batch 3 (4 concurrent agents — larger/complex pages)

#### Task 9: ProjectDashboard.tsx tests (967 lines)
- **File to create:** `src/web/pages/ProjectDashboard/ProjectDashboard.test.tsx`
- **Page location:** `src/web/pages/ProjectDashboard/ProjectDashboard.tsx`
- **What to test:**
  1. Renders stat cards (team size, task counts, completion rates)
  2. Shows project-specific team member avatars
  3. Budget section renders with correct values and progress bar
  4. Budget overage displays proportionally when over 100%
  5. Task analytics section renders correctly
  6. Clicking a task opens TaskDetailDialog
  7. Empty state when project has no data
  8. Loading state while data is being fetched
- **Mocks needed:** API client (GET project dashboard data), ProjectContext, WorkspaceContext, useSession

#### Task 10: ProjectTimeline.tsx tests (607 lines)
- **File to create:** `src/web/pages/ProjectTimeline/ProjectTimeline.test.tsx`
- **Page location:** `src/web/pages/ProjectTimeline/ProjectTimeline.tsx`
- **What to test:**
  1. Groups tasks into correct time buckets (Overdue, Today, This Week, Next Week, Later)
  2. "Unscheduled" section shows tasks without due dates
  3. Task rows display name, assignee avatar, priority, due date
  4. Checkbox toggles task completion
  5. Dropdown menu shows priority change, assign, and move options
  6. Sub-menus render for "Change priority" and "Assign to" actions
  7. Empty timeline shows appropriate message
  8. Accordion sections expand/collapse correctly
- **Mocks needed:** API client (GET tasks with due dates), ProjectContext, WorkspaceContext, useSession

#### Task 11: ProjectSettings.tsx tests (1367 lines)
- **File to create:** `src/web/pages/ProjectSettings/ProjectSettings.test.tsx`
- **Page location:** `src/web/pages/ProjectSettings/ProjectSettings.tsx`
- **What to test:**
  1. Tab navigation works (General, Members, Task Groups, Appearance)
  2. General tab: renders form with project name, description, status, icon
  3. General tab: save button triggers update mutation
  4. Members tab: renders member DataTable with roles
  5. Members tab: invite member functionality
  6. Task Groups tab: renders groups with card-like styling and reorder buttons
  7. Task Groups tab: add/delete group actions work
  8. Appearance tab: theme cards render with palette preview
  9. Appearance tab: selecting a theme triggers update
  10. Cover image section is interactive
- **Mocks needed:** API client (multiple endpoints), ProjectContext, WorkspaceContext, useSession, toast context
- **Note:** This is the largest page. Focus tests on the critical paths (tab switching, form saves) rather than exhaustive UI coverage.

#### Task 12: ForgotPassword + ResetPassword + InviteAccept tests
- **Files to create:**
  - `src/web/pages/ForgotPassword/ForgotPassword.test.tsx`
  - `src/web/pages/ResetPassword/ResetPassword.test.tsx`
  - `src/web/pages/InviteAccept/InviteAccept.test.tsx`
- **Page locations:**
  - `src/web/pages/ForgotPassword/ForgotPassword.tsx`
  - `src/web/pages/ResetPassword/ResetPassword.tsx`
  - `src/web/pages/InviteAccept/InviteAccept.tsx`
- **What to test (ForgotPassword):**
  1. Renders email input and submit button
  2. Validates email format
  3. Shows success message after submission
  4. "Back to login" link navigates correctly
- **What to test (ResetPassword):**
  1. Renders new password and confirm password fields
  2. PasswordRequirements component renders
  3. Validates password match
  4. Calls resetPassword API with token from URL params
  5. Redirects to login on success
- **What to test (InviteAccept):**
  1. Displays invitation details (workspace name, inviter)
  2. Accept button triggers accept-invitation API call
  3. Decline button triggers decline action
  4. Redirects to workspace on acceptance
  5. Handles expired/invalid invitation tokens
- **Mocks needed:** API client, react-router (useParams, useNavigate, useSearchParams), useSession

---

## Post-completion

After all batches:
1. Run `bun run typecheck` — must be 0 errors
2. Run `bun run test` — all new and existing tests must pass
3. Update the project version (patch increment) in package.json per semantic versioning
4. Report total test count increase and new coverage percentage

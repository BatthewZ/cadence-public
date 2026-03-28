# Tier 4 - Minor Polish (m1-m35) ✅ COMPLETED

All 35 minor polish issues (m1-m35) from the UX audit have been implemented.

## Completion Notes (Agent 85812eea, Task 20f7ff7b)

Executed in 2 batches of 4 concurrent agents each (8 agents total):

**Batch 1:**
- Agent A (m1, m12, m17): Dashboard stat cards responsive grid, removed duplicate "View all" link, fixed project task count data flow
- Agent B (m13, m15, m26, m27, m28): Added noValidate to auth forms, confirm password field on register, themed feature icons in AuthLayout, hidden mobile rhythm bars, fixed capitalization consistency
- Agent C (m2, m3, m4, m5): Scrollable settings tabs, reduced empty cover height on mobile, scrollable filter bar, centered workspaces page content
- Agent D (m7, m8, m9, m10, m11): Breadcrumb chevron separators, active workspace indicator, column menu icons, mobile sidebar close button, sidebar notifications link

**Batch 2:**
- Agent E (m22, m24, m25, m32, m33): Task groups card styling, label color swatches, mark-complete visual state, list view status indicators, project rename action
- Agent F (m6, m18, m19, m20): Notification bell badge cap to 9+, activity feed label grouping, My Tasks filter tabs (All/Today/This Week/Overdue), project icon prominence
- Agent G (m14, m16, m34, m35): Workspace URL readonly styling (already done), textarea max-width, sessions list pagination with show-more, revoke-all button with danger styling and confirmation
- Agent H (m21, m23, m29, m30, m31): Unified icon picker to dialog, budget overage bar with proportional split, 44px mobile dropdown touch targets, theme switcher tooltip, theme palette preview strips

**Verification:** `bun run typecheck` passes with 0 errors. ESLint passes with 0 errors (only pre-existing warnings).
**Version:** 0.1.20

## File Conflict Analysis

Issues that share files and **must be in the same agent**:
- **Dashboard.tsx**: m1 (stat cards), m12 (duplicate view all), m17 (project progress 0/0)
- **Auth pages (Register.tsx, Login.tsx, AuthLayout.tsx)**: m13 (native validation), m15 (confirm password), m26 (unused icons), m27 (rhythm bars), m28 (capitalization)
- **AppShell.tsx / Sidebar**: m8 (workspace switcher active indicator), m10 (mobile sidebar close button), m11 (notifications sidebar link)

All other issues touch independent files and can be freely parallelized.

---

## Batch 1 (4 concurrent agents)

### Agent A: Dashboard Fixes — m1, m12, m17

**m1 - Dashboard stat cards mobile layout**
- **File:** `src/web/pages/Dashboard/Dashboard.tsx`, `src/web/components/ui/StatCard.tsx`
- **Problem:** 5 stat cards stack vertically (~850px) on mobile (375x812), pushing actionable content below the fold.
- **Fix:** Wrap stat cards in a 2-column CSS grid on mobile (`grid-template-columns: repeat(2, 1fr)` at small breakpoint). The last odd card can span full width or remain half-width. Consider reducing card padding on mobile.

**m12 - Duplicate "View all" in Dashboard My Tasks card**
- **File:** `src/web/pages/Dashboard/Dashboard.tsx`
- **Problem:** Both "View all" in the My Tasks card header and "View all tasks ->" below the task list link to the same page.
- **Fix:** Remove the redundant "View all tasks ->" link at the bottom of the task list. Keep only the header "View all" link.

**m17 - Project progress cards show "0/0 tasks"**
- **File:** `src/web/pages/Dashboard/Dashboard.tsx`, possibly API handlers in `src/api/routes/`
- **Problem:** All project cards on the dashboard show "Progress: 0/0 tasks" with empty progress bars, despite tasks existing. Data aggregation issue.
- **Fix:** Investigate the data flow. Check if the dashboard API endpoint returns task counts per project. If the API isn't returning counts, add a count query joining tasks to projects. If data exists but isn't rendered, fix the frontend mapping.
- **Note:** This may require backend changes. Check `src/api/routes/dashboard/` or `src/api/routes/projects/` for the data source.

**Verification:** `bun run typecheck`. Screenshot dashboard at both 1280x800 and 375x812.

---

### Agent B: Auth Pages Polish — m13, m15, m26, m27, m28

**m13 - Native browser validation tooltips on auth forms**
- **Files:** `src/web/pages/Login/Login.tsx`, `src/web/pages/Register/Register.tsx`, and any other auth form pages (forgot-password, reset-password)
- **Problem:** Forms use `required` HTML attribute causing native browser tooltips before Zod validation runs. Inconsistent with custom styled errors.
- **Fix:** Add `noValidate` prop to all `<form>` elements on auth pages. Keep `required` for accessibility, but suppress native validation UI.

**m15 - Register page lacks "Confirm Password" field**
- **File:** `src/web/pages/Register/Register.tsx`
- **Problem:** Password entered once with no way to verify. Users may mistype.
- **Fix:** Add a "Confirm Password" field below the password field. Add Zod validation to ensure both fields match. Use the existing `PasswordInput` component (which already has eye toggle from M13 fix). Display a validation error if passwords don't match.

**m26 - Unused icons in AuthLayout**
- **File:** `src/web/components/layout/AuthLayout.tsx`
- **Problem:** `Sparkles`, `Palette`, `Layers` are imported but unused. Only `Check` is used for all feature bullet items.
- **Fix:** Use the specific icons for each feature bullet to add visual variety. Map each feature item to its thematic icon (e.g., Sparkles for one feature, Palette for design-related, Layers for organization). If the icons don't map well, pick better-fitting lucide-react icons.

**m27 - Mobile auth header rhythm bars look like loading artifact**
- **File:** `src/web/components/layout/AuthLayout.tsx` or associated CSS
- **Problem:** Small animated bars at 24px height on mobile auth header may be mistaken for a loading indicator.
- **Fix:** Hide rhythm bars on mobile (`hidden sm:block`) or increase their size to make them clearly decorative rather than functional-looking.

**m28 - Inconsistent capitalization "Sign In" vs "Sign in"**
- **Files:** All auth pages (Login, Register, ForgotPassword, ResetPassword) and AuthLayout
- **Problem:** Login heading says "Sign In" but Register page link text says "Sign in". Inconsistent.
- **Fix:** Audit all auth pages and standardize to "Sign In" (title case) for headings/buttons and "sign in" (lowercase) only in prose sentences.

**Verification:** `bun run typecheck`. Screenshot login, register pages at both viewports.

---

### Agent C: Mobile Layout & Responsiveness — m2, m3, m4, m5

**m2 - Settings sub-tabs "Appearance" truncated on mobile**
- **File:** `src/web/pages/WorkspaceSettings/SettingsNav.tsx` or Project Settings tab bar component
- **Problem:** Tab bar doesn't scroll horizontally; "Appearance" shows as "A..." at the edge on mobile.
- **Fix:** Add `overflow-x: auto`, `white-space: nowrap`, `scrollbar-width: none`, `-webkit-overflow-scrolling: touch` to the settings tab bar container. Ensure tab items use `flex-shrink: 0`.

**m3 - "Add cover" placeholder consumes ~100px when empty**
- **File:** `src/web/components/ui/CoverImage.tsx`
- **Problem:** Empty cover area pushes content down unnecessarily, especially on mobile.
- **Fix:** Reduce the no-cover placeholder height on mobile. Use a media query or responsive class to collapse or shrink (e.g., `h-12 sm:h-24`) when no cover image is set. Consider making it a thin bar with a "+" icon on mobile.

**m4 - Filter bar wraps to two lines on mobile**
- **File:** `src/web/components/project/TaskFilterBar.tsx`
- **Problem:** Filter buttons ("Assigned to", "Priority", "Status", "Due date", "Label") wrap to two lines at 375px.
- **Fix:** Options (pick best after reading code):
  1. Use icon-only filter buttons on mobile (hide text labels, show only icons)
  2. Wrap in a horizontally scrollable container with `overflow-x: auto`
  3. Collapse into a single "Filters" button that opens a sheet/popover on mobile

**m5 - Content not vertically centered on Workspaces page (desktop)**
- **File:** `src/web/pages/Workspaces/Workspaces.tsx`
- **Problem:** Content clusters in top-left quadrant with significant whitespace below at 1280x800.
- **Fix:** Center the content vertically in the viewport. Use `min-h-screen` with flexbox `items-center justify-center` on the container, or add balanced vertical spacing.

**Verification:** `bun run typecheck`. Screenshot settings tabs (mobile), project page (mobile), workspaces page (desktop).

---

### Agent D: Navigation & Sidebar — m7, m8, m9, m10, m11

**m7 - Breadcrumb separator uses "/" instead of chevron**
- **File:** `src/web/components/ui/Breadcrumbs.tsx`
- **Problem:** Plain "/" character separator looks less polished than a chevron icon.
- **Fix:** Replace the "/" separator with a `ChevronRight` icon from lucide-react. Size it appropriately (e.g., 14-16px, muted color).

**m8 - No active workspace indicator in workspace switcher dropdown**
- **File:** `src/web/components/ui/AppShell.tsx` (workspace switcher section)
- **Problem:** Current workspace not highlighted in the switcher dropdown. Theme switcher does this correctly.
- **Fix:** Add a checkmark icon, bold text, or background highlight for the currently active workspace in the dropdown. Look at how the theme switcher marks the active theme and replicate that pattern.

**m9 - Column action menu items lack icons**
- **File:** `src/web/pages/ProjectBoard/ProjectBoard.tsx` or `src/web/components/ui/Swimlane.tsx`
- **Problem:** "Rename", "Change color", "Set as done column", "Delete section" have no icons in the column "..." menu, unlike other menus.
- **Fix:** Add appropriate lucide-react icons: `Pencil` for Rename, `Palette` for Change color, `CheckCircle` for Set as done column, `Trash2` for Delete section. Match the icon size and spacing pattern used in task action and project action menus.

**m10 - Mobile sidebar drawer lacks visible close button**
- **File:** `src/web/components/ui/AppShell.tsx`
- **Problem:** No visible X/close button on mobile sidebar drawer. Users must tap overlay or hamburger.
- **Fix:** Add an `X` icon button in the top-right corner of the mobile sidebar drawer. Style it consistently with other close buttons in the app. Wire it to the same close handler as the overlay tap.

**m11 - Notifications page not accessible from sidebar navigation**
- **File:** `src/web/components/ui/AppShell.tsx` (sidebar links section)
- **Problem:** No sidebar link to Notifications. Only reachable via bell icon dropdown "View all notifications".
- **Fix:** Add a "Notifications" link with `Bell` icon to the sidebar navigation, positioned after "My Tasks" or at the end of the main nav section. Link to the notifications page route.

**Verification:** `bun run typecheck`. Screenshot breadcrumbs, workspace switcher, kanban column menu, mobile sidebar.

---

## Batch 2 (4 concurrent agents)

### Agent E: Task & Project Detail Polish — m22, m24, m25, m32, m33

**m22 - Task Groups tab minimal visual design**
- **File:** `src/web/pages/ProjectSettings/ProjectSettings.tsx` (Task Groups section)
- **Problem:** Rows lack distinct styling. Move up/down arrows look unstyled.
- **Fix:** Add card-like containers (border, rounded corners, subtle background) around each task group row. Style the reorder buttons as proper icon buttons with hover states.

**m24 - Label picker lacks prominent color swatches**
- **File:** `src/web/components/project/TaskLabelPicker.tsx` or `src/web/components/project/LabelManagementDialog.tsx`
- **Problem:** Labels shown as plain text with only a small colored dot. Hard to identify by color.
- **Fix:** Replace the small dot with a larger color indicator — either a colored pill/chip background for each label row, or a prominent color swatch (e.g., 16x16px rounded square) before each label name.

**m25 - "Mark complete" button has no visual completion state**
- **File:** `src/web/pages/TaskDetail/TaskDetailPanel.tsx` or `src/web/components/ui/TaskDetailDialog.tsx`
- **Problem:** Button looks the same whether task is complete or not.
- **Fix:** When the task is marked as done/complete, invert the button styling: change text to "Completed", add a check icon, use green/success background color. When not complete, keep current styling with "Mark complete" text.

**m32 - List view "Done" column shows text status instead of visual indicator**
- **File:** Search for list view component in `src/web/pages/` (ProjectList view)
- **Problem:** "Active" or "Done" as plain text. Should use visual indicator for quicker scanning.
- **Fix:** Replace text with a colored dot + text or a status icon (e.g., green checkmark for Done, blue dot for Active). Match the visual language used elsewhere in the app for task status.

**m33 - Project action dropdown missing "Rename" option**
- **File:** `src/web/pages/Projects/ProjectList.tsx` (project card action menu)
- **Problem:** Must navigate to project settings to rename. Common operation needs a shortcut.
- **Fix:** Add a "Rename" action to the project card dropdown menu. Use `Pencil` icon. On click, either inline-edit the project name or open a small dialog/popover with a text input pre-filled with the current name.

**Verification:** `bun run typecheck`. Screenshot task groups settings, label picker, task detail panel (both complete and incomplete states), list view, project card menu.

---

### Agent F: Data Display & Activity — m6, m18, m19, m20

**m6 - Notification bell lacks badge count indicator**
- **File:** `src/web/components/layout/NotificationBell.tsx`
- **Problem:** No visual indicator for unread notification count. Users must click to check.
- **Fix:** Add a small red badge/dot overlay on the bell icon when unread notifications exist. If the count is available from the API/state, show the number (capped at "9+"). If no count data is available, show a simple dot indicator. Position it at the top-right of the bell icon using absolute positioning.

**m18 - Activity feed shows repetitive label add/remove entries**
- **File:** `src/web/pages/Dashboard/Dashboard.tsx` (activity section) or a dedicated activity feed component, possibly also backend
- **Problem:** Many consecutive entries like "added label X", "removed label X" dominate the feed.
- **Fix:** Group consecutive similar actions by the same user within a short time window. Display as "User updated labels on Task (added X, removed Y)" instead of separate entries. This may require frontend grouping logic or backend changes to the activity query. Implement on the frontend first — group adjacent activity entries with the same user, same task, and label-related action type.

**m19 - My Tasks shows only "This Week" filter**
- **File:** `src/web/pages/MyTasks/MyTasks.tsx`
- **Problem:** No indication of total tasks or tasks across other time periods. No "Overdue" filter.
- **Fix:** Add filter tabs or a dropdown: "All", "Today", "This Week" (current), "Overdue". Add a summary count showing total tasks. The filter should modify the date range used to query/filter tasks.

**m20 - Two projects with same name "Test" are indistinguishable**
- **File:** `src/web/pages/Projects/ProjectList.tsx`
- **Problem:** Two projects named "Test" with different icons but same text. No disambiguation.
- **Fix:** When duplicate project names exist, show additional differentiating info — e.g., the project icon more prominently, or a subtitle with the project's creation date or task count. A simpler approach: the icons are already different, so ensure icons render prominently next to the project name in all contexts (sidebar, lists, breadcrumbs).

**Verification:** `bun run typecheck`. Screenshot notification bell (with unread), activity feed, My Tasks page with filters, projects list.

---

### Agent G: Settings & Forms — m14, m16, m34, m35

**m14 - Workspace URL field appears editable but is read-only**
- **File:** `src/web/pages/WorkspaceSettings/WorkspaceSettings.tsx`
- **Problem:** URL/slug field is a regular textbox with helper text "cannot be changed after creation" but users can type in it.
- **Fix:** Add `readOnly` prop to the input field. Apply visual styling to indicate read-only state (e.g., `bg-surface-secondary`, reduced opacity, or `cursor-not-allowed`). Keep the helper text.

**m16 - Description textarea resize could overflow on mobile**
- **File:** `src/web/components/form/Textarea.tsx` or `src/web/pages/WorkspaceSettings/WorkspaceSettings.tsx`
- **Problem:** Users could resize textarea beyond viewport width on mobile, causing horizontal overflow.
- **Fix:** Add `resize: vertical` (or Tailwind `resize-y`) and `max-width: 100%` to the textarea. If using a shared Textarea component, apply it there. Otherwise, apply inline on the workspace settings textarea.

**m34 - Sessions list unbounded (34 sessions, 5800px page)**
- **File:** Account settings component — search for "sessions" or "Active Sessions" in `src/web/pages/`
- **Problem:** No pagination, virtualization, or max display limit. Excessive scrolling.
- **Fix:** Add a scrollable container with `max-height: 400px` and `overflow-y: auto` around the sessions list. Alternatively, show only the 5 most recent sessions with a "Show all" toggle. Add `scrollbar-gutter: stable` for layout stability.

**m35 - "Revoke All Other Sessions" button styled as text link**
- **File:** Same account settings sessions component as m34
- **Problem:** Destructive action appears as a subtle text link rather than a proper button.
- **Fix:** Style as a proper button using the app's destructive/danger button variant (red background or red outline). Add a confirmation dialog before executing the revoke action if one doesn't already exist.

**Verification:** `bun run typecheck`. Screenshot workspace settings (URL field), account settings (sessions section).

---

### Agent H: Visual & Theme Polish — m21, m23, m29, m30, m31

**m21 - Inconsistent icon picker UI (dialog vs popover)**
- **Files:** `src/web/components/ui/IconPicker.tsx`, project settings, project header
- **Problem:** Settings "Change icon" uses a dialog, but project header icon uses a popover. Same action, two patterns.
- **Fix:** Unify to one approach. The dialog version is cleaner for the full icon grid. Update the project header icon trigger to use the same dialog-based picker. Or if the popover is better, switch both to popover. Pick one and apply consistently.

**m23 - Budget progress bar at 100%+ has no proportional overage indication**
- **File:** `src/web/pages/ProjectDashboard/ProjectDashboard.tsx` or a budget component
- **Problem:** $425 spent on $2 budget shows full red bar but no sense of how far over budget.
- **Fix:** Show the overage proportionally. Options: (1) extend the bar beyond 100% with a red overage section, (2) show a numeric label like "21,250% over budget" or "$423 over", (3) use a different visual treatment when over 100% (e.g., pulsing red bar with overage text). At minimum, display the overage amount as text.

**m29 - Theme selector touch targets below 44px minimum**
- **File:** Theme switcher dropdown component CSS
- **Problem:** Menu items are 31.5px tall, below the 44px minimum recommended for mobile.
- **Fix:** Add a mobile media query to increase menu item `min-height` to 44px and `padding` to compensate. Apply to the theme dropdown menu items specifically, or to all dropdown menu items globally if they share a component.

**m30 - Theme switcher button label hidden on mobile**
- **File:** Theme switcher component in navbar
- **Problem:** Only shows colored dot + icon on mobile, hides theme name text. Less discoverable.
- **Fix:** Add a tooltip on mobile that shows the theme name on press/hover. Or use `aria-label` for accessibility. The visual-only approach is acceptable if the tooltip is implemented.

**m31 - Appearance tab theme cards have small color dots**
- **File:** `src/web/pages/ProjectSettings/ProjectSettings.tsx` (Appearance tab)
- **Problem:** Small color dots may not clearly communicate what each theme looks like.
- **Fix:** Replace small dots with larger preview swatches (e.g., 32x32px or a mini color strip showing 3-4 theme colors). This gives users a better preview of the theme before selecting.

**Verification:** `bun run typecheck`. Screenshot icon picker (both contexts), project dashboard budget section, theme switcher (mobile), appearance settings.

---

## Post-completion

After all batches are done:
1. Run `bun run typecheck` — must be 0 errors
2. Run `bun run test` for any files with associated tests
3. Update the project version (patch increment) in package.json per semantic versioning
4. Take final screenshots of key pages at both desktop (1280x800) and mobile (375x812) to verify overall polish

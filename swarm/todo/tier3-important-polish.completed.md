# Tier 3 - Important Polish

These are the next-priority fixes from the UX audit (PLAN.md items M15, M12, M10, M11, M6, M7, M9, M17, M18). All critical (C1-C4) and Tier 2 major UX gap issues are resolved or in progress.

## Dependencies

- **M10** (Workspaces page avatar menu) and **M11** (Workspace member count) both modify `src/web/pages/Workspaces/Workspaces.tsx`. They **must be combined into a single task** to avoid merge conflicts.
- All other tasks are fully independent and touch different files.

## Concurrency Plan

9 issues across 8 tasks (M10+M11 combined). Run in 3 batches of 3 concurrent agents.

---

### Batch 1 (3 concurrent agents - quick CSS/styling fixes)

#### Task 1: M12 - Auth pages mobile whitespace gap
- **File:** `src/web/components/layout/AuthLayout.tsx` and its associated CSS
- **Problem:** Large blank gap (~100-120px) between the dark branded header strip and the form card below on mobile (375x812). Pushes form content down, wastes vertical space, may require scrolling when keyboard appears.
- **Fix:** Reduce the gap on mobile between the `auth-mobile-header` and the `auth-form-panel`. Use a media query to reduce padding/margin on mobile viewports. The `.auth-form-panel` likely has excessive `padding-top` or there's a gap/margin between the header and form. Target `max-width: 640px` breakpoint. Reduce to ~24-32px gap on mobile.
- **Verification:** Run `bun run typecheck`. Take a screenshot at 375x812 viewport of the login page to confirm the gap is reduced and the form is positioned better.

#### Task 2: M7 - Archived project badge visibility
- **File:** `src/web/pages/Projects/ProjectList.tsx` (lines 38-42 for status badge variant mapping, line 239 for badge rendering)
- **Problem:** The "archived" badge has a very pale yellow/cream background barely distinguishable from the white card background. "Active" badge is similarly subtle.
- **Fix:** Update the `statusBadgeVariant` mapping (around lines 38-42) to use more visually distinct badge variants. For "archived", use a variant with stronger contrast (e.g., a more prominent yellow/amber or gray background). For "active", use a green/success variant. Consider also reducing opacity or adding a subtle gray overlay on the entire archived project card to make it visually distinct from active projects.
- **Verification:** Run `bun run typecheck`. Take a screenshot of the projects list page showing both active and archived projects to confirm badges are clearly distinguishable.

#### Task 3: M17 - Cover image hover/focus state
- **File:** `src/web/components/ui/CoverImage.tsx`
- **Problem:** The "Add cover" placeholder area shows no visual feedback on hover (no background darkening, border highlight, or cursor change). Users may not realize this area is interactive.
- **Fix:** Check the current state of CoverImage.tsx. The exploration found it already has `group-hover` opacity transitions with `bg-black/0 ... group-hover:bg-black/40` for the overlay and `opacity-0 ... group-hover:opacity-100` for buttons. If these are working, the fix may already be done. If not, ensure:
  1. The no-cover state container has `cursor: pointer` and `group` class
  2. On hover, show a subtle background change (e.g., `hover:bg-surface-secondary` or a dashed border highlight)
  3. The "Add cover" text/icon has appropriate hover styling
- **Verification:** Run `bun run typecheck`. Take a screenshot of a project page with no cover image, hovering over the "Add cover" area if possible, to confirm visual feedback is present.

---

### Batch 2 (3 concurrent agents - medium complexity component changes)

#### Task 4: M15 - Members table mobile responsiveness
- **File:** `src/web/pages/WorkspaceSettings/WorkspaceMembers.tsx`
- **Problem:** On mobile (375px), the "Joined" column is completely missing and the "Owner" role badge text is clipped at the right edge. Same column layout as desktop with no responsive adaptation.
- **Fix:** Options (pick the best approach after reading the current code):
  1. **Responsive column hiding:** Use CSS or a responsive hook to hide the "Joined" column on mobile (`hidden sm:table-cell`). Ensure the remaining columns (Name, Email, Role, Actions) fit within mobile width.
  2. **Card layout on mobile:** If the DataTable component supports it, switch to a card-based layout on mobile where each member is a card showing avatar, name, email, role.
  3. **Horizontal scroll:** Add `overflow-x: auto` to the table container with `-webkit-overflow-scrolling: touch`.
  The simplest approach is responsive column hiding + ensuring remaining columns use appropriate widths.
- **Verification:** Run `bun run typecheck`. Take a screenshot at 375x812 viewport of the workspace members page to confirm all visible data fits without clipping.

#### Task 5: M9 - Icon picker button affordance in Create Project dialog
- **Files:** `src/web/components/ui/CreateProjectDialog.tsx`, `src/web/components/ui/IconPicker.tsx`
- **Problem:** The "Choose icon" button in the Create Project dialog looks like plain label text with no visual affordance (no icon preview, no border, no button-like styling). Users don't realize it's clickable.
- **Fix:** Style the icon picker trigger as a proper button with:
  1. A border/outline (matching the form field style)
  2. A placeholder icon preview (show the currently selected icon or a default icon)
  3. Hover state with background/border color change
  4. `cursor: pointer`
  Look at how the IconPicker component renders its trigger. If it uses a popover, ensure the trigger button has proper button styling consistent with other form fields in the dialog.
- **Verification:** Run `bun run typecheck`. Take a screenshot of the Create Project dialog to confirm the icon picker has proper button styling with visual affordance.

#### Task 6: M18 - Sidebar collapsed accessibility
- **Files:** `src/web/components/ui/AppShell.tsx`, `src/web/components/layout/WorkspaceLayout.tsx`
- **Problem:** When the sidebar is collapsed (icon-only mode), navigation links lose their accessible names in the DOM. Screen readers cannot identify the links. Tooltips appear on hover but don't help assistive technology.
- **Fix:** Add `aria-label` attributes to all collapsed sidebar links. When the sidebar is collapsed:
  1. Each navigation link (Dashboard, My Tasks, Projects, etc.) should have `aria-label="Dashboard"`, `aria-label="My Tasks"`, etc.
  2. The `aria-label` should match the visible text that appears when the sidebar is expanded
  3. If tooltips are already present, ensure they use `role="tooltip"` and are linked via `aria-describedby`
  4. Look at the SidebarLink or similar component that renders each nav item
  Search for how sidebar links are rendered - they may be in AppShell.tsx, WorkspaceLayout.tsx, or a separate SidebarLinks component. The `aria-label` should always be present (even when expanded, it's harmless) or conditionally added when `collapsed` is true.
- **Verification:** Run `bun run typecheck`. Take a screenshot of the sidebar in collapsed mode. Inspect the rendered HTML to verify `aria-label` attributes are present on navigation links.

---

### Batch 3 (2-3 concurrent agents - higher complexity)

#### Task 7: M10 + M11 - Workspaces page avatar menu + member count fix (COMBINED)
- **Files:** `src/web/pages/Workspaces/Workspaces.tsx`, `src/web/components/layout/UserMenu.tsx`
- **Problem (M10):** The user avatar in the top-right corner of the Workspaces page (`/workspaces`) does not open any dropdown or menu when clicked. No way to sign out or access account settings from this page.
- **Problem (M11):** Workspace cards show "0 members" which is incorrect since the logged-in user is a member. Likely `memberCount` is not being populated correctly.
- **Fix (M10):** The `UserMenu.tsx` component already exists and provides a dropdown with account/sign-out options. Import and use `<UserMenu />` in the Workspaces page header (around lines 199-203) to wrap or replace the plain Avatar component. Ensure it renders the same avatar but opens the dropdown menu on click.
- **Fix (M11):** Investigate the data flow:
  1. Check the API endpoint that returns workspace list data (likely in `src/worker/routes/` or similar)
  2. Check the database query that fetches workspaces to see if it includes a member count join/subquery
  3. If the API doesn't return `memberCount`, add a count query joining the workspace members table
  4. If the API returns it but the frontend doesn't use it, fix the frontend mapping
  The member count display is around lines 277-281 in Workspaces.tsx using `ws.memberCount`.
- **Verification:** Run `bun run typecheck`. Take a screenshot of the Workspaces page to confirm: (1) clicking the avatar opens a dropdown with Sign Out and account options, (2) workspace cards show correct member counts (at least "1 member").

#### Task 8: M6 - Timeline view unscheduled tasks section
- **File:** `src/web/pages/ProjectTimeline/ProjectTimeline.tsx`
- **Problem:** Tasks without due dates do not appear anywhere in the timeline. No "Unscheduled" section exists. Users lose visibility of tasks without dates.
- **Fix:** Add an "Unscheduled" accordion section to the timeline view:
  1. In the time-bucket grouping logic (around lines 100-139), add filtering for tasks where `dueDate` is null/undefined
  2. Create a new "Unscheduled" bucket that collects these tasks
  3. Render it as the last accordion section (after "Later")
  4. Use appropriate styling - perhaps a slightly different visual treatment (muted/gray header) to distinguish from date-based sections
  5. Show the count of unscheduled tasks in the section header
  The existing `TimelineTaskRow` component (lines 154-574) should work as-is for rendering these tasks. The main change is in the grouping/bucketing logic and adding the new section to the accordion.
- **Verification:** Run `bun run typecheck`. Take a screenshot of the timeline view to confirm an "Unscheduled" section appears showing tasks without due dates.

---

## Post-completion

After all tasks are done:
1. Run `bun run typecheck` to verify no type errors were introduced
2. Run any relevant tests: `bun run test` for affected areas
3. Update the project version (patch increment) in package.json per semantic versioning rules

---

## Completion Notes (Agent 6827a2c9)

All 8 tasks (9 issues) completed successfully across 3 batches.

### Summary of changes:

| Task | Files Modified | Status |
|------|---------------|--------|
| M12 - Auth mobile whitespace | `src/web/style/components/auth-layout.css` | Done - Added mobile media query to reduce gap |
| M7 - Archived badge visibility | `src/web/pages/Projects/ProjectList.tsx` | Done - Updated badge variants, added opacity-60 for archived |
| M17 - Cover image hover | `src/web/components/ui/CoverImage.tsx` | Done - Added dashed border, hover highlight, focus ring |
| M15 - Members table mobile | `src/web/components/ui/DataTable.tsx`, `src/web/pages/WorkspaceSettings/WorkspaceMembers.tsx` | Done - Added className support to DataTable columns, responsive column hiding |
| M9 - Icon picker affordance | `src/web/components/ui/IconPicker.tsx` | Done - Replaced IconButton with styled button trigger |
| M18 - Sidebar a11y | `src/web/components/ui/AppShell.tsx` | Done - Added aria-label to sidebar links |
| M10 - Workspaces avatar menu | `src/web/pages/Workspaces/Workspaces.tsx`, `src/web/components/layout/UserMenu.tsx`, `src/web/components/ui/AppShell.tsx` | Done - Added UserMenu, useOptionalAppShell |
| M11 - Member count fix | `src/api/routes/workspaces/workspaces.handlers.ts` | Done - Added member count query |
| M6 - Timeline unscheduled | `src/web/pages/ProjectTimeline/ProjectTimeline.tsx` | Done - Added "Unscheduled" bucket section |

### Verification:
- `bun run typecheck`: 0 errors (all 3 targets + eslint clean)
- DataTable tests: 31 pass
- Workspace handler tests: 31 pass
- Version bumped from 0.1.11 → 0.1.12

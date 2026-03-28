# Tier 2 - Major UX Gaps

These are the next-priority fixes from the UX audit (PLAN.md items M1, M2, M4, M5, M8, M13). All critical (C1-C4) issues have been resolved.

## Dependencies

None of these tasks depend on each other. They touch different files and different areas of the app, so all can be parallelized freely.

## Concurrency Plan

All 6 tasks are independent. Run them in two batches of 3 concurrent agents.

---

### Batch 1 (3 concurrent agents - quick fixes)

#### Task 1: M2 - Keyboard Shortcuts dialog mobile overflow
- **File:** `src/features/keyboard-shortcuts/keyboard-shortcuts-dialog.css`
- **Problem:** `min-width: 400px` overflows 375px mobile viewport, clipping title and content.
- **Fix:** Change `min-width: 400px` to `min-width: min(400px, calc(100vw - 32px))`.
- **Verification:** Run typecheck. Take a screenshot at 375x812 viewport of the keyboard shortcuts dialog to confirm it fits.

#### Task 2: M5 - Remove duplicate theme switcher on dashboard
- **File:** `src/features/dashboard/Dashboard.tsx`
- **Problem:** Two `<ThemeSwitcher />` components render on the dashboard - one in the page header area and one in the navbar. Redundant and confusing.
- **Fix:** Remove the `<ThemeSwitcher />` from the dashboard page header. Keep only the navbar instance. Look for TWO instances of `<ThemeSwitcher` in Dashboard.tsx and remove the one that is NOT in the navbar/top bar.
- **Verification:** Run typecheck. Take a screenshot of the dashboard page to confirm only one theme switcher is visible.

#### Task 3: M4 - Standardize destructive action styling across all menus
- **Files:** Search for all `DropdownMenu.Item` or similar menu item components that contain delete/remove/destroy actions across the entire `src/` directory.
- **Problem:** "Delete task" uses red text/icon (correct), but "Delete project", "Delete section", and other destructive actions use default gray styling. Inconsistent.
- **Fix:** For every dropdown menu item that performs a destructive action (delete, remove, destroy, revoke), apply the danger/destructive variant styling. Look at how "Delete task" is styled and replicate that pattern. This likely means adding a `className` with a danger/destructive variant or a `variant="danger"` prop. Search the codebase for the existing red-styled delete to find the exact pattern used.
- **Verification:** Run typecheck. Take screenshots of project action menu, section/column action menu, and any other menus with delete actions to confirm consistent red styling.

---

### Batch 2 (3 concurrent agents - medium complexity)

#### Task 4: M8 - Project view tab bar horizontal scroll on mobile
- **Files:** Find the tab bar component used in project views (Board, List, Timeline, Dashboard, Settings tabs). Likely in `src/features/projects/` or a shared layout component.
- **Problem:** On mobile (375px), "Settings" tab is completely hidden off-screen with no scroll indicator. Users don't know it exists.
- **Fix:** Add `overflow-x: auto` to the tab bar container. Add a visual scroll indicator - either a gradient fade on the right edge when scrollable, or ensure the container scrolls smoothly. Consider adding `scrollbar-width: none` / `-webkit-overflow-scrolling: touch` for a clean mobile scroll experience. The tab items should not wrap.
- **Verification:** Run typecheck. Take a screenshot at 375x812 viewport of a project page showing the tab bar to confirm all tabs are accessible via scroll.

#### Task 5: M13 - Password visibility toggle on all password fields
- **Files:** Search for all password `<input>` or `<Input>` fields across auth pages (login, register, reset-password) and account settings (change password). Check if there's a shared Input component that could be extended.
- **Problem:** No eye/eye-off toggle on any password field. Users cannot verify what they typed.
- **Fix:** Add a toggle button (eye icon when hidden, eye-off icon when visible) inside or adjacent to each password input. Clicking it toggles the input type between "password" and "text". Use lucide-react icons (`Eye`, `EyeOff`) which are already a project dependency. If there's a shared password input component, add the toggle there. Otherwise, create a `PasswordInput` wrapper or add the toggle to each individual password field.
- **Verification:** Run typecheck. Take screenshots of the login page, register page, and account settings change password section to confirm the eye toggle is visible and functional.

#### Task 6: M1 - Replace native `<select>` with custom dropdowns in task detail
- **Files:** `src/features/tasks/TaskDetailPanel.tsx` (lines ~969, 1013, 1032 for Group/Status, Priority, Assignee selects)
- **Problem:** Native `<select>` elements for Priority, Group/Status, and Assignee. No custom styling, no color coding, no avatars, no search. Inconsistent with rest of app.
- **Fix:** Replace each native `<select>` with a custom popover/dropdown component. Look at how the label picker is implemented in the same file for the pattern to follow. For each field:
  - **Priority:** Use a popover with colored indicators for each priority level (e.g., red for Urgent, orange for High, yellow for Medium, blue/gray for Low, gray for None). Look at how priorities are displayed elsewhere in the app (kanban cards, list view) for the color mapping.
  - **Group/Status:** Use a popover showing available groups/statuses with their associated colors.
  - **Assignee:** Use a popover showing workspace members with their avatars and names. Add a search/filter input if the member list is long.
  - All popovers should use the existing UI popover/dropdown primitives from the project's component library.
- **Verification:** Run typecheck. Take a screenshot of the task detail panel showing the new custom dropdowns to confirm they render correctly with colors/avatars.

---

## Post-completion

After all tasks are done, run `bun run typecheck` to verify no type errors were introduced. Update the project version (patch increment) in package.json per semantic versioning rules.

# Remaining Major UX Issues (M3, M14, M16)

Three Major issues from the UX audit (PLAN.md) were not included in any tier's task file and remain unimplemented. These are all independent and can be executed concurrently.

## Dependencies

None. All three tasks touch different files and different areas of the app. Run all 3 agents concurrently.

## Concurrency Plan

All 3 tasks are independent. Run them as a single batch of 3 concurrent agents.

---

### Batch 1 (3 concurrent agents)

#### Task 1: M3 - Task action dropdown requires internal scrolling
- **Location:** Task action dropdown menu on kanban board
- **Problem:** The task action dropdown has 557-579px of content but only 460px visible height. Users must scroll within the dropdown to reach "Clear due date" and "Delete task" at the bottom. Users may not realize there are more options below the fold.
- **Files to investigate:** Search for the task action dropdown/context menu in `src/web/pages/ProjectBoard/` or `src/web/components/`. Look for where task card actions like "Change priority", "Assign to", "Delete task" are rendered in a dropdown.
- **Fix options (pick best after reading code):**
  1. **Sub-menus:** Move "Change priority" options and "Assign to" options into sub-menus (flyout menus) to reduce the total item count in the main dropdown. This is the cleanest approach.
  2. **Compact layout:** Reduce padding/spacing on dropdown items to fit more items in the visible area.
  3. **Grouped sections:** Use section dividers to visually group related items and add a scroll indicator (e.g., a subtle gradient at the bottom when scrollable).
  4. **Ensure max-height + scroll indicator:** If scrolling is kept, add a visual scroll indicator (bottom gradient fade or scroll shadow) so users know there are more items.
- **Verification:** Run `bun run typecheck`. Take a screenshot of the task action dropdown on the kanban board to confirm all items are accessible without surprising hidden content.

#### Task 2: M14 - Register form lacks password strength indicator
- **Location:** Register page (`/register`)
- **Problem:** No indication of password requirements (minimum length, complexity, etc.). Users only discover requirements after submission fails. This reduces confidence during account creation.
- **Files to investigate:** `src/web/pages/Register/Register.tsx`. Also check the auth validation schema (search for Zod schemas related to registration/password) to understand actual password requirements.
- **Fix:**
  1. Read the Zod validation schema for registration to determine actual password requirements (min length, complexity rules, etc.)
  2. Add a password requirements list or strength meter below the password field. Options:
     - **Simple (preferred):** Show static text below the password field listing requirements (e.g., "Must be at least 8 characters"). Check off requirements in real-time as the user types.
     - **Strength meter:** Add a visual strength bar (weak/medium/strong) that updates as the user types. Use colors: red (weak), yellow (medium), green (strong).
  3. If a `PasswordInput` component already exists (from M13 fix), extend it to accept a `showRequirements` or `showStrength` prop.
  4. Requirements should appear once the user starts typing in the password field, not before.
- **Verification:** Run `bun run typecheck`. Take a screenshot of the register page while typing in the password field to confirm requirements/strength indicator is visible.

#### Task 3: M16 - No email field in Account Settings profile section
- **Location:** Account Settings (`/w/:slug/account`), Profile section
- **Problem:** The Profile section only shows avatar upload and Display Name. No email display or email change capability. Users cannot see or update their registered email address.
- **Files to investigate:** Search for the account settings page in `src/web/pages/` (likely `AccountSettings.tsx` or similar). Also check the auth/user API for endpoints that return or update email.
- **Fix:**
  1. Add an email display field to the Profile section, below the Display Name field.
  2. Determine if email should be editable:
     - **Read-only (simpler, preferred if no email change API exists):** Show the user's email as a read-only field with `readOnly` styling (muted background, `cursor-not-allowed`). This at least lets users see their registered email.
     - **Editable (if API supports it):** Add an editable email field with save functionality. Email changes typically require verification, so only do this if there's existing backend support.
  3. Fetch the user's email from the auth context or user profile API.
  4. Position it between the Display Name field and the Save button.
- **Verification:** Run `bun run typecheck`. Take a screenshot of the Account Settings profile section to confirm the email field is visible.

---

## Post-completion

After all tasks are done:
1. Run `bun run typecheck` to verify no type errors were introduced
2. Run any relevant tests: `bun run test` for affected areas
3. Update the project version (patch increment) in package.json per semantic versioning rules

---

## Completion Notes (Agent 9e19ed62)

All 3 tasks completed concurrently. Post-completion verification passed.

### Task 1: M3 - Task action dropdown ✅
- **Approach:** Sub-menus (Option 1) — "Change priority", "Assign to", and "Move to" collapsed into hover-triggered flyout sub-menus using floating-ui's `safePolygon`.
- **Files modified:** `DropdownMenu.tsx` (added Sub, SubTrigger, SubContent, SubItem components), `use-floating.ts` (added safePolygon export), `ProjectBoard.tsx`, `ProjectTimeline.tsx`, `dropdown-menu.css`
- **Result:** Main dropdown reduced to ~6 items, eliminating internal scrolling entirely.

### Task 2: M14 - Password strength indicator ✅
- **Approach:** Created `PasswordRequirements` component with real-time checklist (Check/X icons from lucide-react). Appears only when user starts typing.
- **Files created:** `PasswordRequirements.tsx`, `password-requirements.css`, `PasswordRequirements.test.tsx` (14 tests)
- **Files modified:** `Register.tsx`, `ResetPassword.tsx`, form index, style index
- **Result:** Requirements (8+ chars, uppercase, lowercase, number) shown with green checkmarks/gray X as user types.

### Task 3: M16 - Email field in Account Settings ✅
- **Approach:** Read-only email field (Better Auth has no email change API). Disabled input with helper text "Email address cannot be changed."
- **Files modified:** `ProfileSection.tsx`
- **Result:** Email displayed between avatar and Display Name, with disabled styling.

### Verification
- `bun run typecheck`: 0 errors (backend, web, tests all pass)
- `bun run test`: 125 test files, 1352 tests all passing
- ESLint: 0 errors, 36 pre-existing warnings only
- Version: 0.1.23

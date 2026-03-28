# Component Decomposition Refactor

## Context

Many page and component files have grown to 1000+ lines, making them hard to navigate and maintain. The `Settings` page already follows a clean pattern: a thin orchestrator file that imports from `./components/{Section}.tsx`. This refactor applies that pattern consistently across the entire `src/web/` frontend.

**Goal:** Move sub-components out of monolithic files into `{feature}/components/{Component}.tsx` files. Pure structural move — no functionality changes. Copy/paste code, update imports, verify.

**Gold standard:** `src/web/pages/Settings/Settings.tsx` (47 lines, imports 4 section components from `./components/`)

---

## Target Pattern

```
pages/{Feature}/
  {Feature}.tsx              ← thin orchestrator (imports + composition only)
  {Feature}.test.tsx         ← existing tests (update imports if needed)
  components/
    {SubComponent}.tsx       ← extracted sub-component
    {SubComponent}.tsx
    ...
```

For shared UI components under `components/ui/`:
```
components/ui/
  {Component}.tsx            ← thin orchestrator or keep if already focused
  {Component}/
    {SubPart}.tsx            ← only if the component has clear sub-parts
```

**Rules:**
- No barrel files (`index.ts`) in page-level `components/` dirs — use direct imports
- Main page file re-exports itself as default (keep existing pattern)
- Each extracted file gets its own imports — no implicit dependencies
- Types/interfaces used only by one extracted component move with it
- Types/interfaces shared across multiple extracted components go in a `types.ts` in the same `components/` dir
- Helper functions used by one component move with it; shared helpers go in a `helpers.ts`

---

## Shared Components: TaskDetail

`TaskDetailPanel.tsx` and `TaskDetailDialog.tsx` both define duplicate sub-components: `PropertyRow`, `SortableSubtaskRow`. These should be extracted to a shared location:

```
pages/TaskDetail/
  components/
    PropertyRow.tsx          ← shared by Panel and Dialog
    SortableSubtaskRow.tsx   ← shared by Panel and Dialog
    PropertyEditors.tsx      ← PriorityPicker, GroupPicker, AssigneePicker + ReadOnly variants
    PropertyDisplays.tsx     ← PriorityDot, GroupChip, AssigneeChip
    TaskDetailPanelInner.tsx ← main panel logic
```

`TaskDetailDialog.tsx` (in `components/ui/`) imports from `@/web/pages/TaskDetail/components/` for shared pieces.

---

## Work Chunks

### Chunk 1: Tier 1 Critical Files (6 agents concurrent)

These are the largest files and are independent of each other. Each agent handles one file.

| Agent | File | Lines | Target |
|-------|------|-------|--------|
| 1 | `pages/TaskDetail/TaskDetailPanel.tsx` | 1693 | Extract 12 sub-components to `TaskDetail/components/` |
| 2 | `pages/ProjectBoard/ProjectBoard.tsx` | 1391 | Extract 7 sub-components + helpers to `ProjectBoard/components/` |
| 3 | `pages/ProjectSettings/ProjectSettings.tsx` | 1367 | Extract 4 tab components to `ProjectSettings/components/` |
| 4 | `pages/Dashboard/Dashboard.tsx` | 1279 | Extract 13 sub-components to `Dashboard/components/` |
| 5 | `pages/ProjectDashboard/ProjectDashboard.tsx` | 967 | Extract 11 sub-components to `ProjectDashboard/components/` |
| 6 | `components/ui/TaskDetailDialog.tsx` | 1323 | Remove duplicated sub-components, import shared ones from `TaskDetail/components/` |

**Dependency note:** Agent 6 (TaskDetailDialog) depends on Agent 1 (TaskDetailPanel) completing first, since the shared components are extracted by Agent 1. **Run Agent 1 first or in the same chunk but with Agent 6 waiting on Agent 1's shared component extraction.**

**Revised strategy:** Run Agents 1-5 concurrently. Then run Agent 6 after Agent 1 completes.

**After Chunk 1:** Merge all work, run `swarm up qa`.

---

### Chunk 2: Tier 2 High Priority + Tier 3 Medium (6 agents concurrent)

| Agent | File | Lines | Target |
|-------|------|-------|--------|
| 1 | `pages/WorkspaceSettings/WorkspaceWebhooks.tsx` | 914 | Extract dialogs, forms, table to `WorkspaceSettings/components/` |
| 2 | `pages/ThemeEditor/ThemeEditor.tsx` | 707 | Extract inputs, preview, constants to `ThemeEditor/components/` |
| 3 | `pages/Landing/Landing.tsx` | 626 | Extract sections, animations, constants to `Landing/components/` |
| 4 | `pages/ProjectTimeline/ProjectTimeline.tsx` | 607 | Extract TaskRow, date utils, grouping to `ProjectTimeline/components/` |
| 5 | `components/project/TaskFilterBar.tsx` | 576 | Extract 5 filter components + chips to `components/project/filters/` |
| 6 | `pages/TaskDetail/TaskAttachmentSection.tsx` | 558 | Extract sub-components to `TaskDetail/components/` (dir already exists from Chunk 1) |

**After Chunk 2:** Merge all work, run `swarm up qa`.

---

### Chunk 3: Tier 3 Remaining + Tier 4 (6 agents concurrent)

| Agent | File | Lines | Target |
|-------|------|-------|--------|
| 1 | `components/ui/CommandPalette.tsx` | 539 | Extract renderers, constants to `components/ui/command-palette/` |
| 2 | `pages/WorkspaceSettings/WorkspaceTeams.tsx` | 485 | Extract dialogs, TeamCard to `WorkspaceSettings/components/` (dir exists from Chunk 2) |
| 3 | `pages/Projects/ProjectList.tsx` | 478 | Extract ProjectCard, dialogs to `Projects/components/` |
| 4 | `pages/Workspaces/Workspaces.tsx` | 459 | Extract PendingInvitations, CreateDialog, helpers to `Workspaces/components/` |
| 5 | `pages/WorkspaceSettings/WorkspaceMembers.tsx` | 428 | Extract dialogs to `WorkspaceSettings/components/` (dir exists) |
| 6 | `components/layout/WorkspaceLayout.tsx` | 391 | Extract SidebarNav, WorkspaceSwitcher to `components/layout/workspace/` |

**After Chunk 3:** Merge all work, run `swarm up qa`.

---

### Chunk 4: Cleanup + Remaining (3-4 agents concurrent)

| Agent | File | Lines | Target |
|-------|------|-------|--------|
| 1 | `components/ui/BulkActionBar.tsx` | 396 | Extract dropdown components to `components/ui/bulk-actions/` |
| 2 | `pages/Notifications/Notifications.tsx` | 357 | Extract action renderers, filters to `Notifications/components/` |
| 3 | `pages/MyTasks/MyTasks.tsx` | 335 | Extract sub-components if applicable to `MyTasks/components/` |
| 4 | Global import audit | — | Verify all cross-file imports resolve, no broken references |

**After Chunk 4:** Merge all work, run `swarm up qa`.

---

## Detailed Extraction Plans

### Agent Instructions Template

Each agent should follow this process:

1. **Read** the target file completely
2. **Create** the `components/` directory (or equivalent)
3. **Extract** each sub-component:
   - Copy the component function and its local types/constants to the new file
   - Add necessary imports to the new file
   - Replace the component in the original file with an import from the new file
4. **Update** any external files that import the moved components (search with grep)
5. **Verify:**
   - `bun run typecheck` passes
   - `bun run test:web` passes (or specific test file if one exists)
   - No broken imports across the codebase

### Chunk 1 Detailed

#### Agent 1: TaskDetailPanel.tsx (1693 lines)

Create `src/web/pages/TaskDetail/components/`:

| New File | Components to Extract | Approx Lines |
|----------|----------------------|--------------|
| `PropertyRow.tsx` | `PropertyRow` | ~20 |
| `PropertyDisplays.tsx` | `PriorityDot`, `GroupChip`, `AssigneeChip` | ~60 |
| `PropertyEditors.tsx` | `PriorityPicker`, `PriorityPickerReadOnly`, `GroupPicker`, `GroupPickerReadOnly`, `AssigneePicker`, `AssigneePickerReadOnly` | ~300 |
| `SortableSubtaskRow.tsx` | `SortableSubtaskRow` | ~110 |
| `TaskDetailPanelInner.tsx` | `TaskDetailPanelInner` | ~1100 |

The main `TaskDetailPanel.tsx` becomes a thin wrapper importing `TaskDetailPanelInner`.

#### Agent 2: ProjectBoard.tsx (1391 lines)

Create `src/web/pages/ProjectBoard/components/`:

| New File | Components to Extract | Approx Lines |
|----------|----------------------|--------------|
| `dnd-helpers.ts` | `parseId`, `groupIdStr`, `taskIdStr`, `sortByPosition`, type definitions | ~80 |
| `TaskCard.tsx` | `SortableTaskCard`, `TaskCardOverlay` | ~330 |
| `AddTaskForm.tsx` | `AddTaskInline` | ~100 |
| `BoardColumn.tsx` | `SortableColumn`, `ColumnOverlay` | ~400 |
| `AddGroupColumn.tsx` | `AddGroupColumn` | ~80 |
| `BoardSkeleton.tsx` | `BoardSkeletonColumns` | ~50 |

Main `ProjectBoard.tsx` keeps the DnD orchestration, multi-select logic, and imports sub-components.

#### Agent 3: ProjectSettings.tsx (1367 lines)

Create `src/web/pages/ProjectSettings/components/`:

| New File | Components to Extract | Approx Lines |
|----------|----------------------|--------------|
| `GeneralTab.tsx` | `GeneralTab` (lines ~176-601) | ~425 |
| `MembersTab.tsx` | `MembersTab` (lines ~602-832) | ~230 |
| `TaskGroupsTab.tsx` | `TaskGroupsTab` (lines ~833-1281) | ~450 |
| `AppearanceTab.tsx` | `AppearanceTab` (lines ~1282-1367) | ~85 |
| `types.ts` | Shared types (`UpdateProjectInput`, `AddProjectMemberInput`, role constants) | ~40 |

Main `ProjectSettings.tsx` becomes tab container with imports — mirrors `Settings.tsx` pattern.

#### Agent 4: Dashboard.tsx (1279 lines)

Create `src/web/pages/Dashboard/components/`:

| New File | Components to Extract | Approx Lines |
|----------|----------------------|--------------|
| `OverdueAlert.tsx` | `OverdueTasksSection` | ~60 |
| `StatCards.tsx` | `StatCardsRow` | ~90 |
| `ArchivedSummary.tsx` | `ArchivedProjectsSummary` | ~40 |
| `PriorityBreakdown.tsx` | `PriorityBreakdownSection` | ~70 |
| `TeamWorkload.tsx` | `TeamWorkloadSection` | ~60 |
| `ActivityFeed.tsx` | `WorkspaceActivityFeed` | ~170 |
| `TaskLists.tsx` | `TaskRow`, `TimeGroupedTaskList`, `MyTasksPreview` | ~230 |
| `ProjectsSection.tsx` | `ProjectCard`, `ProjectsGrid` | ~120 |
| `CostSummary.tsx` | `CostSummaryCard` | ~50 |
| `DashboardSkeleton.tsx` | `DashboardSkeleton` | ~80 |
| `types.ts` | `DashboardStatsResponse`, `DashboardTask`, etc. | ~40 |

#### Agent 5: ProjectDashboard.tsx (967 lines)

Create `src/web/pages/ProjectDashboard/components/`:

| New File | Components to Extract | Approx Lines |
|----------|----------------------|--------------|
| `OverdueAlert.tsx` | `OverdueTasksSection` | ~55 |
| `StatCards.tsx` | `StatCardsRow` | ~50 |
| `BudgetSection.tsx` | `BudgetAndCostsSection`, `BudgetCard` | ~170 |
| `PriorityBreakdown.tsx` | `PriorityBreakdownSection` | ~70 |
| `TasksByGroup.tsx` | `TasksByGroupSection` | ~65 |
| `TeamWorkload.tsx` | `TeamWorkloadSection` | ~55 |
| `ActivityFeed.tsx` | `ProjectActivityFeed` | ~160 |
| `UpcomingTasks.tsx` | `UpcomingTasksSection` | ~85 |
| `CostPerMember.tsx` | `CostPerMemberSection` | ~50 |
| `DashboardSkeleton.tsx` | `DashboardSkeleton` | ~50 |

#### Agent 6: TaskDetailDialog.tsx (1323 lines) — AFTER Agent 1

- Remove local `PropertyRow` and `SortableSubtaskRow` definitions
- Import them from `@/web/pages/TaskDetail/components/PropertyRow` and `@/web/pages/TaskDetail/components/SortableSubtaskRow`
- If the remaining dialog-specific logic is still large, extract dialog sections into sub-components alongside the file or into a `components/ui/task-detail-dialog/` directory
- Verify the dialog still renders and functions identically

---

### Chunk 2 Detailed

#### Agent 1: WorkspaceWebhooks.tsx (914 lines)

Extract to `src/web/pages/WorkspaceSettings/components/` (already has `WebhookEventSelector.tsx`):

| New File | Components to Extract |
|----------|----------------------|
| `SecretDisplay.tsx` | `SecretDisplay` |
| `WebhookFormFields.tsx` | Shared form fields for create/edit |
| `CreateWebhookDialog.tsx` | Create dialog + form logic |
| `EditWebhookDialog.tsx` | Edit dialog + form logic |
| `DeleteWebhookDialog.tsx` | Delete confirmation dialog |
| `TestResultDialog.tsx` | Test delivery result display |
| `WebhookColumns.tsx` | Data table column definitions |

#### Agent 2: ThemeEditor.tsx (707 lines)

Create `src/web/pages/ThemeEditor/components/`:

| New File | Components to Extract |
|----------|----------------------|
| `token-constants.ts` | `COLOR_GROUPS`, `TYPOGRAPHY_TOKENS`, `RADIUS_TOKENS`, `SHADOW_TOKENS`, `MOTION_TOKENS`, `OVERLAY_TOKENS`, `TRANSITION_TOKENS`, `TAB_CONFIG`, `ALL_TOKENS` |
| `TokenInputs.tsx` | `ColorTokenInput`, `TextTokenInput`, `TokenGroupSection` |
| `LivePreview.tsx` | `LivePreview` |
| `helpers.ts` | `getComputedVar`, `snapshotAll`, `toHex` |

#### Agent 3: Landing.tsx (626 lines)

Create `src/web/pages/Landing/components/`:

| New File | Components to Extract |
|----------|----------------------|
| `constants.ts` | `FEATURES`, `THEMES`, `MOCK_COLUMNS`, `RHYTHM_HEIGHTS`, `PRIORITY_DOT` |
| `LandingNav.tsx` | `LandingNav` |
| `HeroSection.tsx` | `HeroSection`, `GradientOrbs`, `SectionWave` |
| `FeaturesSection.tsx` | `FeaturesSection` |
| `ProductShowcase.tsx` | `MockCard`, `ProductShowcase`, `RhythmBars` |
| `ThemesSection.tsx` | `ThemesSection` |
| `CtaSection.tsx` | `CtaSection` |
| `LandingFooter.tsx` | `LandingFooter` |

#### Agent 4: ProjectTimeline.tsx (607 lines)

Create `src/web/pages/ProjectTimeline/components/`:

| New File | Components to Extract |
|----------|----------------------|
| `date-helpers.ts` | `endOfWeek`, `startOfNextWeek`, `endOfNextWeek`, `endOfMonth`, `formatDueDate` |
| `grouping.ts` | `groupTasksIntoBuckets`, `TimeBucket` type |
| `TimelineTaskRow.tsx` | `TimelineTaskRow` with all inline handlers |

#### Agent 5: TaskFilterBar.tsx (576 lines)

Create `src/web/components/project/filters/`:

| New File | Components to Extract |
|----------|----------------------|
| `AssigneeFilter.tsx` | `AssigneeFilter` |
| `PriorityFilter.tsx` | `PriorityFilter` |
| `StatusFilter.tsx` | `StatusFilter` |
| `DueDateFilter.tsx` | `DueDateFilter` |
| `LabelFilter.tsx` | `LabelFilter` |
| `FilterChips.tsx` | `FilterChips` |

Main `TaskFilterBar.tsx` becomes composition of filter imports. Update `components/project/index.ts` barrel if `TaskFilterBar` is exported there.

#### Agent 6: TaskAttachmentSection.tsx (558 lines)

Extract to `src/web/pages/TaskDetail/components/` (already exists from Chunk 1):

| New File | Components to Extract |
|----------|----------------------|
| `FileTypeIcon.tsx` | `FileTypeIcon`, `isImageType` |
| `AttachmentRow.tsx` | `AttachmentRow` |
| `ImageLightbox.tsx` | `ImageLightbox` |
| `CompactDropZone.tsx` | `CompactDropZone` |
| `AttachmentSkeleton.tsx` | `AttachmentSkeletonList` |

---

### Chunk 3 Detailed

#### Agent 1: CommandPalette.tsx (539 lines)

Create `src/web/components/ui/command-palette/`:

| New File | Components to Extract |
|----------|----------------------|
| `constants.ts` | `NAVIGATION_ITEMS`, `QUICK_ACTIONS` |
| `item-renderers.tsx` | `getItemKey`, `getItemLabel`, `getItemContext`, `renderItemIcon`, `renderItemBadge` |

Move main `CommandPalette` into this directory. Update the original file to re-export from the new location for backwards compatibility.

#### Agent 2: WorkspaceTeams.tsx (485 lines)

Extract to `src/web/pages/WorkspaceSettings/components/` (exists from Chunk 2):

| New File | Components to Extract |
|----------|----------------------|
| `TeamCard.tsx` | `TeamCard` component |
| `CreateTeamDialog.tsx` | Create team dialog + form |
| `EditTeamDialog.tsx` | Edit team dialog + form |
| `DeleteTeamDialog.tsx` | Delete confirmation |
| `AddTeamMemberDialog.tsx` | Add member dialog |

#### Agent 3: ProjectList.tsx (478 lines)

Create `src/web/pages/Projects/components/`:

| New File | Components to Extract |
|----------|----------------------|
| `ProjectCard.tsx` | Individual project card rendering |
| `RenameProjectDialog.tsx` | Rename dialog + form |
| `ProjectActionMenu.tsx` | Dropdown action menu for projects |

#### Agent 4: Workspaces.tsx (459 lines)

Create `src/web/pages/Workspaces/components/`:

| New File | Components to Extract |
|----------|----------------------|
| `PendingInvitations.tsx` | `PendingInvitations` component |
| `CreateWorkspaceDialog.tsx` | `CreateWorkspaceDialog` component |
| `helpers.ts` | `slugify`, `getGreeting`, `getWorkspaceInitial`, `getWorkspaceColor`, `WORKSPACE_COLORS` |

#### Agent 5: WorkspaceMembers.tsx (428 lines)

Extract to `src/web/pages/WorkspaceSettings/components/` (exists):

| New File | Components to Extract |
|----------|----------------------|
| `InviteMemberDialog.tsx` | Invite member dialog + form |
| `ChangeRoleDialog.tsx` | Role change dialog |
| `RemoveMemberDialog.tsx` | Remove member confirmation |
| `MemberColumns.tsx` | DataTable column definitions |

#### Agent 6: WorkspaceLayout.tsx (391 lines)

Create `src/web/components/layout/workspace/`:

| New File | Components to Extract |
|----------|----------------------|
| `SidebarNav.tsx` | Sidebar navigation links and project list |
| `WorkspaceSwitcher.tsx` | Workspace dropdown switcher |

Move main `WorkspaceLayout` into this directory. Update `components/layout/index.ts` barrel to re-export from new location.

---

### Chunk 4 Detailed

#### Agent 1: BulkActionBar.tsx (396 lines)

Create `src/web/components/ui/bulk-actions/`:

| New File | Components to Extract |
|----------|----------------------|
| `PriorityDropdown.tsx` | `PriorityDropdown` |
| `AssignDropdown.tsx` | `AssignDropdown` |
| `MoveToGroupDropdown.tsx` | `MoveToGroupDropdown` |

Move main `BulkActionBar` into this directory. Update any imports.

#### Agent 2: Notifications.tsx (357 lines)

Create `src/web/pages/Notifications/components/`:

| New File | Components to Extract |
|----------|----------------------|
| `NotificationActions.tsx` | `renderActions` logic extracted to component |
| `NotificationFilters.tsx` | Filter tab/toggle UI |

#### Agent 3: MyTasks.tsx (335 lines)

Assess whether extraction is needed (borderline size). If sub-components exist, extract to `MyTasks/components/`. If file is mostly one component with hooks, leave as-is and document the decision.

#### Agent 4: Global Import Audit

- Grep entire `src/web/` for any broken imports
- Run `bun run typecheck`
- Run `bun run test:web`
- Run `bun run build`
- Fix any remaining issues

---

## Dependency Graph

```
Chunk 1 (5 concurrent + 1 sequential):
  ┌─────────────────────────────────────────────────────┐
  │  Agent 1: TaskDetailPanel ──┐                       │
  │  Agent 2: ProjectBoard      │ (all concurrent)      │
  │  Agent 3: ProjectSettings   │                       │
  │  Agent 4: Dashboard         │                       │
  │  Agent 5: ProjectDashboard  │                       │
  │                             ▼                       │
  │               Agent 6: TaskDetailDialog (after A1)  │
  └─────────────────────────────────────────────────────┘
                        │
                        ▼
                  swarm up qa
                        │
                        ▼
  Chunk 2 (6 concurrent):
  ┌─────────────────────────────────────────────────────┐
  │  Agent 1: WorkspaceWebhooks                         │
  │  Agent 2: ThemeEditor                               │
  │  Agent 3: Landing                                   │
  │  Agent 4: ProjectTimeline                           │
  │  Agent 5: TaskFilterBar                             │
  │  Agent 6: TaskAttachmentSection                     │
  └─────────────────────────────────────────────────────┘
                        │
                        ▼
                  swarm up qa
                        │
                        ▼
  Chunk 3 (6 concurrent):
  ┌─────────────────────────────────────────────────────┐
  │  Agent 1: CommandPalette                            │
  │  Agent 2: WorkspaceTeams                            │
  │  Agent 3: ProjectList                               │
  │  Agent 4: Workspaces                                │
  │  Agent 5: WorkspaceMembers                          │
  │  Agent 6: WorkspaceLayout                           │
  └─────────────────────────────────────────────────────┘
                        │
                        ▼
                  swarm up qa
                        │
                        ▼
  Chunk 4 (4 agents, 3 concurrent + 1 sequential):
  ┌─────────────────────────────────────────────────────┐
  │  Agent 1: BulkActionBar     │                       │
  │  Agent 2: Notifications     │ (concurrent)          │
  │  Agent 3: MyTasks           │                       │
  │                             ▼                       │
  │               Agent 4: Global Import Audit          │
  └─────────────────────────────────────────────────────┘
                        │
                        ▼
                  swarm up qa (final)
```

---

## Files NOT Being Refactored (and why)

| File | Lines | Reason |
|------|-------|--------|
| `DropdownMenu.tsx` | 609 | Compound component pattern — splitting would break the API contract |
| `CoverImage.tsx` | 454 | Single forwardRef component with tightly coupled drag/upload logic |
| `AppShell.tsx` | 357 | Layout primitive — already focused |
| `Tabs.tsx` | 368 | Compound component pattern |
| `DataTable.tsx` | 330 | Generic component — already focused |
| `Carousel.tsx` | 333 | Single-purpose UI component |
| `ProjectContext.tsx` | 309 | Context provider — not a component decomposition target |
| `ProjectLayout.tsx` | 358 | Layout with mixed concerns but tightly coupled |
| All `*.test.tsx` files | Various | Tests stay co-located; update imports only |

---

## Verification Steps (per chunk)

Each agent runs after their extraction:
1. `bun run typecheck` — no TypeScript errors
2. `bun run test:web` — all web tests pass
3. Grep for any remaining imports of moved components that weren't updated

After each chunk merge:
1. `bun run typecheck` — full type check
2. `bun run test` — full test suite (web + api + unit)
3. `bun run build` — production build succeeds
4. `swarm up qa` — full QA pipeline (refactor check, bug check, docs sync, test + push)

Final verification after all chunks:
1. All of the above
2. Grep audit: no file in `src/web/pages/` over 500 lines (excluding test files)
3. Every page directory with extracted components has a `components/` subdirectory
4. No circular imports introduced

---

## Risk Mitigation

1. **Merge conflicts between concurrent agents**: Each agent works on a different file/directory. The only shared touchpoint is WorkspaceSettings/components/ (Chunks 2-3) — agents writing to the same directory must create different files.

2. **Broken imports**: Each agent greps the entire codebase for imports of the component they're moving and updates all references. The Chunk 4 global audit catches any misses.

3. **Test failures**: Tests import the main page component (e.g., `ProjectBoard`). Since the main file still exports the same component (just thinner), tests should work without changes. If tests import sub-components directly, the agent updates those imports.

4. **Shared types**: When a type is used by multiple extracted components, it goes in a `types.ts` file in the same `components/` directory rather than being duplicated.

5. **Rollback**: Each chunk is a separate commit. If a chunk breaks, revert that commit and retry.

---

## Version Bump

After all chunks complete successfully, bump the project version (minor version increment) per semantic versioning rules, since this is a non-breaking structural change.

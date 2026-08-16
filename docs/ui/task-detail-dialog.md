# TaskDetailDialog

Full task detail dialog that fetches a task by ID and renders inline-editable properties, subtasks, and comments. Designed for use outside of project context — fetches its own data via `GET /api/tasks/:taskId` so it can be opened from Dashboard, MyTasks, or any page with a task ID. Supports permission-aware editing via project membership checks.

**Source:** `src/web/components/ui/TaskDetailDialog.tsx`

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `taskId` | `string` | The task to display. |
| `members` | `WorkspaceMember[]` | Workspace members (used for assignee dropdown and comment author display). |
| `open` | `boolean` | Controls dialog visibility. |
| `onClose` | `() => void` | Called when the dialog should close. |

## Permissions

The dialog fetches project members via `GET /api/projects/:projectId/members` and uses `useProjectPermissions` to determine whether the current user can edit tasks. When `canEditTasks` is false, all editing controls (title, properties, subtasks, comments) are disabled or hidden, rendering the dialog in read-only mode.

## Sections

### Cover Image

Renders a `CoverImage` component at the top of the dialog. Supports upload, Unsplash photo apply, removal, and repositioning via drag. A cover is persisted as either a `coverImageKey` (R2 upload) or a `coverUnsplash` payload — never both at once; the XOR invariant is enforced by the backend and mirrored in every optimistic path of [`useTaskCover`](./hooks.md#usetaskcover). Uploads go to `PUT /api/tasks/:taskId/cover`; Unsplash applies go to `PUT /api/tasks/:taskId/cover/unsplash`; both clear the opposing cover source.

### Header

- Icon picker — click to open a `Popover` with `IconGrid` for selecting a task icon. Uses `IconDisplay` for rendering. Hidden in read-only mode.
- Editable title — click to enter edit mode; saves on blur or Enter; Escape cancels.
- Close button (X icon).

### Mark Complete / Incomplete

Full-width toggle button. Calls `POST /api/tasks/:taskId/complete` or `/uncomplete`. Disabled when `canEditTasks` is false.

### Properties

Inline-editable property rows:

| Property | Control | API |
| --- | --- | --- |
| Group | Native `<Select>` (task groups for the project, completion group marked with ✓) | `PATCH /api/tasks/:taskId/move` |
| Priority | Native `<Select>` (`TASK_PRIORITIES`) | `PATCH /api/tasks/:taskId` |
| Assignee | Native `<Select>` (workspace members, with "Unassigned" option) | `PATCH /api/tasks/:taskId` |
| Due date | Date input | `PATCH /api/tasks/:taskId` |
| Cost | Number input with `$` prefix (stored as cents) | `PATCH /api/tasks/:taskId` |

Task groups are fetched via `GET /api/projects/:projectId/task-groups` once the task's project ID is known. All property controls are disabled when `canEditTasks` is false.

> **Note:** The full-page [`TaskDetailPanel`](../../src/web/pages/TaskDetail/TaskDetailPanel.tsx) uses custom popover-based pickers (`GroupPicker`, `PriorityPicker`, `AssigneePicker`) with read-only variants. This dialog intentionally uses simpler native `<Select>` elements for a lighter-weight experience.

### Description

Textarea that saves on blur via `PATCH /api/tasks/:taskId`. Read-only when the user lacks edit permissions.

### Subtasks

- Drag-and-drop reordering via `@dnd-kit/core` and `@dnd-kit/sortable` with `DragOverlay` for visual feedback. Reorder persists via `PATCH /api/subtasks/:id/reorder`.
- `SortableSubtaskRow` component with grip handle, `TaskCheckbox` toggle, inline rename on double-click, and hover-reveal delete button.
- Inline "Add subtask" input — creates via `POST /api/tasks/:taskId/subtasks` on Enter. Hidden in read-only mode.

### Attachments

File attachments section powered by `TaskAttachmentSection` (`src/web/pages/TaskDetail/TaskAttachmentSection.tsx`) and `useTaskAttachments` hook (`src/web/hooks/use-task-attachments.ts`).

- Fetches attachments via `GET /api/tasks/:taskId/attachments` using `useTaskAttachments`.
- **Upload:** Compact drag-and-drop zone or file picker. Validates file type against `ALLOWED_ATTACHMENT_TYPES` and enforces a 10 MB size limit and 20 attachments per task cap. Uploads via `POST /api/tasks/:taskId/attachments` with `multipart/form-data`.
- **Display:** Each attachment shows a file-type icon (or image thumbnail for images), filename, size, relative timestamp, and hover-reveal download/delete actions.
- **Image lightbox:** Clicking an image thumbnail opens a fullscreen lightbox overlay with keyboard navigation (arrow keys, Escape).
- **Deletion:** Uses `ConfirmDialog` for confirmation, then calls `DELETE /api/tasks/:taskId/attachments/:attachmentId`.
- **Optimistic updates:** Uploads show an optimistic row (with spinner and reduced opacity) immediately. Deletions optimistically remove the row and rollback on error.
- Hidden entirely in read-only mode when there are no attachments.

### Comments

- Comments are fetched via cursor-paginated `GET /api/tasks/:taskId/comments` using the shared [`useTaskComments`](hooks.md#usetaskcomments) hook. Initial page loads 20 comments; a "Load more comments" button fetches the next page.
- While the initial page is loading, a [`CommentSkeletonList`](skeleton.md#commentskeletonlist) placeholder is shown.
- The comment count in the section header displays `task.commentCount` (server-provided total) rather than the length of the loaded array.
- If the comments query fails, an inline "Failed to load comments." message is shown above the comment list.
- Existing comments with author avatar, name, date, and "(edited)" indicator when `updatedAt` differs from `createdAt`.
- Comment body rendered with [`Markdown`](markdown.md) (lite-markdown + `@mention` highlighting).
- Own comments show hover-reveal Edit and Delete actions.
- Edit mode: inline textarea with save/cancel icons.
- Add comment: textarea + "Comment" button. Creates via `POST /api/tasks/:taskId/comments`.
- Update via `PATCH /api/comments/:id`, delete via `DELETE /api/comments/:id`.

## Dirty-Fields Guard

Both `TaskDetailDialog` and `TaskDetailPanel` use a `dirtyFields` ref (`useRef<Set<string>>`) to track which fields the user is actively editing. When a server refetch arrives (via React Query background revalidation), the sync effect skips overwriting any field whose key is in the dirty set, preventing the server response from clobbering in-progress input. Each field adds its key on `onFocus` and removes it on blur (after saving). The set is cleared when the dialog is first opened or the task ID changes.

Tracked fields: `"title"`, `"description"`, `"cost"`.

## Optimistic Updates

The dialog maintains a local optimistic copy of the task (`localTask`) seeded from the server response. Mutations update the local state immediately and roll back on failure:

- **Property patches** — local state updated before API call; reverted on error.
- **Subtask creation** — an optimistic subtask (with an `optimistic-` prefixed ID) is appended to `localTask.subtasks` immediately. The optimistic subtask is not draggable. On success, the query is invalidated and the server-assigned subtask replaces the placeholder.
- **Subtask toggle/delete/rename/reorder** — reflected locally, then confirmed via API.
- **Comment creation** — an optimistic comment (with an `optimistic-` prefixed ID and reduced opacity) is appended to the React Query cache immediately. Edit and delete actions are hidden on optimistic comments. On success, the comments query is invalidated.
- **Comment editing** — the comment body is optimistically updated in the React Query cache; rolled back on error.
- **Comment deletion** — mutations invalidate the comments query.

## Loading & Error States

- While loading: Skeleton placeholders (title + 4 property rows).
- On error: Error message displayed inline.
- Individual sections (e.g., comments) show their own inline error messages when their respective queries fail, independent of the top-level task loading state.

## Duplicate Task

A "Duplicate task" link (with Copy icon) appears next to the delete button when `canEditTasks` is true. Calls `POST /api/tasks/:taskId/duplicate`, then invalidates task and dashboard queries. The `TaskDetailPanel` variant also adds the duplicated task to the project context via `addTask`.

## Delete Task

The delete confirmation dialog uses the shared [`ConfirmDialog`](confirm-dialog.md) component. On confirm, the task is deleted via `DELETE /api/tasks/:taskId`, followed by invalidation of `queryKeys.tasks.detail(taskId)` and `queryKeys.workspaces.dashboard(workspace.id)`.

## Cache Invalidation

All mutations invalidate `queryKeys.tasks.detail(taskId)`, `queryKeys.tasks.comments(taskId)`, `queryKeys.workspaces.dashboard(workspace.id)`, and (when a `projectId` is available) `queryKeys.projects.tasks(projectId)` and `queryKeys.projects.dashboard(projectId)` to keep project board/list views and the project dashboard in sync. Each mutation also calls `freshnessTracker.recordMutation("tasks")` so the freshness poller skips re-invalidation for changes the current user already applied locally. Attachment mutations additionally invalidate `queryKeys.tasks.attachments(taskId)` and `queryKeys.tasks.activity(taskId)`.

That `recordMutation` call belongs in **`onMutate`**, not only at settle. The suppression window has to open when the write *starts*: the poll cycle is shorter than a slow `PATCH`, so a freshness-driven refetch can otherwise land mid-write and repaint the pre-write value over the optimistic one before the response arrives. Recording again at settle then covers the refetch the write itself triggers.

## Live Updates While Open

Both the dialog and `TaskDetailPanel` keep a local optimistic copy of the task and reconcile it through the shared [`useTaskServerSync`](hooks.md#usetaskserversync) hook. A collaborator's edit reaches an already-open view through the freshness poller: it invalidates the `["tasks"]` prefix, the detail query refetches, and the hook replaces the local copy with the new row.

`useTaskServerSync` documents the two caller preconditions that make wholesale adoption safe — mid-edit fields must not render from the local copy, and mutations must open the freshness suppression window in `onMutate`. Both hold here: [`useTaskEditing`](hooks.md#usetaskediting) owns title and cost, [`EditableMarkdown`](markdown.md) owns the description draft, and every mutation on this view records its `"tasks"` mutation as described above.

## Usage

```tsx
import { TaskDetailDialog } from "@/web/components/ui/TaskDetailDialog";

const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

{selectedTaskId && (
  <TaskDetailDialog
    taskId={selectedTaskId}
    members={members}
    open={!!selectedTaskId}
    onClose={() => setSelectedTaskId(null)}
  />
)}
```

## Where Used

- **Dashboard** — task rows and "My Tasks" preview open this dialog instead of navigating to the project board.
- **MyTasks** — task table rows open this dialog on click.

## Dependencies

- [`Dialog`](dialog.md), [`ConfirmDialog`](confirm-dialog.md), [`Avatar`](avatar.md), [`Button`](button.md), [`IconButton`](icon-button.md), [`Skeleton`](skeleton.md), [`Text`](text.md), [`Toast`](toast.md)
- [`CoverImage`], [`IconDisplay`], [`IconGrid`](icon-picker), [`Markdown` / `EditableMarkdown`](markdown.md), [`Popover`](popover.md)
- Form primitives: `Input`, `Select`, `TaskCheckbox`, `Textarea`; `MarkdownEditor` for comment authoring
- Shared extracted components from `pages/TaskDetail/components/`: `TaskDetailProperties` (property grid), `TaskSubtaskList` (drag-and-drop subtask list), `TaskCommentSection` (comment list with edit/delete), `PropertyRow`, `SortableSubtaskRow`
- `@dnd-kit/core`, `@dnd-kit/sortable` (subtask drag-and-drop)
- `@tanstack/react-query` (`useQuery`, `useMutation`, `useQueryClient`)
- [`useTaskComments`](hooks.md#usetaskcomments) (paginated comment fetching)
- [`useTaskCommentActions`](hooks.md#usetaskcommentactions) (comment CRUD mutations + optimistic updates)
- [`useTaskDetailActions`](hooks.md#usetaskdetailactions) (complete/duplicate/delete actions)
- [`useTaskAttachments`](hooks.md#usetaskattachments) (attachment fetching with optimistic cache helpers)
- [`useTaskServerSync`](hooks.md#usetaskserversync) (adopts the fetched row into the local copy)
- `useWorkspace` context (for dashboard cache invalidation on task delete)

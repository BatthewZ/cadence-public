# CreateProjectDialog

Form dialog for creating a new project within a workspace. Wraps `Dialog` with a form containing name, icon picker, description fields, and an expandable "Options" section for budget and theme. Uses `react-query` mutations and invalidates workspace project queries on success.

**Source:** `src/web/components/ui/CreateProjectDialog.tsx`

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `workspaceId` | `string` | The workspace to create the project in. |
| `open` | `boolean` | Controls dialog visibility. |
| `onClose` | `() => void` | Called when the dialog should close (Cancel button or backdrop). |
| `onCreated` | `(projectId: string) => void` | Called after successful creation with the new project's ID. |

## Behavior

- Sends `POST /api/workspaces/:workspaceId/projects` with `{ name, description?, icon?, budget?, theme? }`.
- Budget is entered in dollars and converted to cents before submission.
- Theme defaults to the workspace theme when not explicitly set (`null`).
- Invalidates `queryKeys.workspaces.projects(workspaceId)` on success.
- Form resets (name, description, icon, budget, theme, error) on close and after successful creation.
- Submit is disabled while the mutation is pending or the name is empty.
- Displays an `Alert` if the mutation fails.

## Fields

| Field | Required | Description |
| --- | --- | --- |
| Name | Yes | Project name (text input, autofocused). |
| Icon | No | Emoji/icon via `IconPicker` (compact mode, no portal). |
| Description | No | Free-text description (textarea, 3 rows). |
| Budget | No | Dollar amount input (converted to cents). Inside the "Options" accordion. |
| Theme | No | Theme selection via `ThemeGrid`. Inherits workspace theme when `null`. Inside the "Options" accordion. |

## Usage

```tsx
import { CreateProjectDialog } from "@/web/components/ui/CreateProjectDialog";

<CreateProjectDialog
  workspaceId={workspace.id}
  open={dialogOpen}
  onClose={() => setDialogOpen(false)}
  onCreated={(projectId) => {
    setDialogOpen(false);
    navigate(`/w/${workspace.slug}/projects/${projectId}/board`);
  }}
/>
```

## Where Used

- **ProjectList** — "+ New Project" button opens this dialog.
- **WorkspaceLayout sidebar** — "+" button in the Projects section header opens this dialog; on creation, navigates to the new project's board.

## Dependencies

- [`Dialog`](dialog.md), [`IconPicker`](../../src/web/components/ui/IconPicker.tsx), [`ThemeGrid`](../../src/web/components/ui/ThemeGrid.tsx)
- [`Accordion`](accordion.md) — wraps the optional Budget and Theme fields
- [`useWorkspace`](../../src/web/contexts/WorkspaceContext.tsx) — reads workspace theme for default display
- Form primitives: `Field`, `FormActions`, `Input`, `Label`, `Textarea`
- `@tanstack/react-query` (`useMutation`, `useQueryClient`)

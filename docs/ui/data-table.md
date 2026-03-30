# DataTable

High-level data table built on [Table](table.md). Accepts a typed data array and column definitions, then handles sorting, row selection, pagination, loading skeletons, and empty states automatically.

**Source:** `src/web/components/ui/DataTable.tsx`
**Dependencies:** `Table`, `Checkbox`, `EmptyState`, `Pagination`, `Skeleton`

## Props

### DataTableProps\<T\>

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `T[]` | **required** | Array of row objects. |
| `columns` | `ColumnDef<T>[]` | **required** | Column definitions (see below). |
| `rowKey` | `(row: T, index: number) => string \| number` | **required** | Unique key extractor for each row. |
| `sort` | `SortState` | -- | Controlled sort state. When provided, sorting is server-side (data order is not modified). |
| `onSortChange` | `(sort: SortState \| null) => void` | -- | Callback when sort changes. Works in both controlled and uncontrolled modes. |
| `sortComparator` | `(a: T, b: T, columnKey: string, direction: "asc" \| "desc") => number` | Default comparator | Custom sort function for client-side sorting. |
| `selectable` | `boolean` | `false` | Enables row selection with checkboxes. |
| `selectedKeys` | `Set<string \| number>` | -- | Set of selected row keys (controlled). |
| `onSelectionChange` | `(keys: Set<string \| number>) => void` | -- | Callback when selection changes. |
| `page` | `number` | -- | Current page number (1-indexed). |
| `totalPages` | `number` | -- | Total number of pages. |
| `onPageChange` | `(page: number) => void` | -- | Callback when page changes. Renders a `Pagination` component below the table. |
| `density` | `"dense" \| "comfortable" \| "spacious"` | `"comfortable"` | Passed through to `Table`. |
| `striped` | `boolean` | `false` | Passed through to `Table`. |
| `stickyHeader` | `boolean` | `false` | Passed through to `Table`. |
| `loading` | `boolean` | `false` | Shows skeleton rows instead of data. |
| `loadingRowCount` | `number` | `5` | Number of skeleton rows to display when loading. |
| `emptyContent` | `ReactNode` | Default `EmptyState` | Custom content shown when `data` is empty. |
| `rowClassName` | `(row: T, index: number) => string` | -- | Dynamic CSS class for each `Table.Row`, useful for per-row animations or conditional styling. |

### ColumnDef\<T\>

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `key` | `string` | **required** | Column identifier. Used as sort key and data accessor fallback. |
| `header` | `ReactNode` | **required** | Header cell content. |
| `render` | `(row: T, index: number) => ReactNode` | -- | Custom cell renderer. Falls back to `String(row[key])`. |
| `sortable` | `boolean` | -- | Enables sorting on this column. |
| `width` | `string \| number` | -- | Column width. |
| `align` | `"left" \| "center" \| "right"` | -- | Text alignment for header and body cells. |
| `className` | `string` | -- | Additional CSS class applied to both the header and body cells (e.g. responsive visibility). |

### SortState

```ts
type SortState = { key: string; direction: "asc" | "desc" };
```

## Sorting

### Uncontrolled (client-side)

When `sort` prop is omitted, DataTable manages sort state internally and sorts `data` in memory.

- Click a sortable column: ascending → descending → unsorted (cycle).
- Uses the default comparator (numeric comparison for numbers, `localeCompare` for strings) unless `sortComparator` is provided.

### Controlled (server-side)

When `sort` is provided, DataTable does not reorder `data`. The parent is responsible for fetching sorted data and passing it in. `onSortChange` fires with the new sort state (or `null` to clear).

## Selection

When `selectable` is `true`:

- A checkbox column is prepended to the table.
- Header checkbox toggles select-all / deselect-all for visible rows.
- The header checkbox shows an indeterminate state when some (but not all) rows are selected.
- Selected rows receive accent-tinted background via `Table.Row`'s `selected` prop.
- Selection state is fully controlled via `selectedKeys` and `onSelectionChange`.

## Loading State

When `loading` is `true`:

- Header row renders normally (with column headers).
- Body renders `loadingRowCount` skeleton rows using `Skeleton` components.
- Selection checkboxes appear as rectangular skeletons.
- Striping is disabled during loading.

## Empty State

When `data` is empty and `loading` is `false`:

- Header row renders normally.
- Body renders a single full-width cell containing `emptyContent` or a default `EmptyState` with "No data" title and description.

## Pagination

When `page`, `totalPages`, and `onPageChange` are all provided, a centered `Pagination` component renders below the table with `16px` top margin.

## Usage

### Basic

```tsx
import { DataTable, type ColumnDef } from "@/web/components/ui/DataTable";

type User = { id: number; name: string; email: string };

const columns: ColumnDef<User>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "email", header: "Email" },
];

<DataTable
  data={users}
  columns={columns}
  rowKey={(row) => row.id}
/>
```

### With Selection and Pagination

```tsx
const [selected, setSelected] = useState<Set<string | number>>(new Set());
const [page, setPage] = useState(1);

<DataTable
  data={users}
  columns={columns}
  rowKey={(row) => row.id}
  selectable
  selectedKeys={selected}
  onSelectionChange={setSelected}
  page={page}
  totalPages={10}
  onPageChange={setPage}
/>
```

### Server-Side Sorting

```tsx
const [sort, setSort] = useState<SortState | null>(null);

<DataTable
  data={serverData}
  columns={columns}
  rowKey={(row) => row.id}
  sort={sort ?? undefined}
  onSortChange={setSort}
/>
```

### Loading State

```tsx
<DataTable
  data={[]}
  columns={columns}
  rowKey={(row) => row.id}
  loading
  loadingRowCount={8}
/>
```

### Custom Empty State

```tsx
<DataTable
  data={[]}
  columns={columns}
  rowKey={(row) => row.id}
  emptyContent={<p>No users found. Try adjusting your filters.</p>}
/>
```

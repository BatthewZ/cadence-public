# Table

Low-level table primitive with compound sub-components for semantic table markup. Supports density variants, striped rows, row selection highlighting, sortable header cells, and sticky headers. Provides context to enforce compound usage.

**Source:** `src/web/components/ui/Table.tsx`
**Styles:** `src/web/style/components/table.css`

## Compound API

| Component          | Element    | Purpose                                                        |
| ------------------ | ---------- | -------------------------------------------------------------- |
| `Table`            | `<div>` + `<table>` | Root wrapper. Provides density/striped context to children. Wraps a `<table>` inside a scrollable `<div>`. |
| `Table.Head`       | `<thead>`  | Table head section.                                            |
| `Table.Body`       | `<tbody>`  | Table body section.                                            |
| `Table.Row`        | `<tr>`     | Table row with optional `selected` and striped styling.        |
| `Table.HeaderCell` | `<th>`     | Header cell with optional sort indicator and keyboard support. |
| `Table.Cell`       | `<td>`     | Data cell. Density padding applied via context.                |

All sub-components must be used within a `<Table>` root (enforced via context).

## Props

### Table (root)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `density` | `"dense" \| "comfortable" \| "spacious"` | `"comfortable"` | Controls cell padding and font size. |
| `striped` | `boolean` | `false` | Alternates even row backgrounds. |
| `stickyHeader` | `boolean` | `false` | Makes the header row stick to the top on scroll. |
| `className` | `string` | -- | Additional CSS classes on the outer wrapper `<div>`. |

### Table.Row

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `selected` | `boolean` | `false` | Applies accent-tinted background to indicate selection. |
| `className` | `string` | -- | Additional CSS classes on the `<tr>`. |

### Table.HeaderCell

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `sortDirection` | `"asc" \| "desc" \| false` | -- | Current sort state. Shows `ArrowUp`, `ArrowDown`, or `ArrowUpDown` icon. Omit for non-sortable columns. |
| `onSort` | `() => void` | -- | Sort callback. When provided, the cell becomes clickable and keyboard-activatable. |
| `className` | `string` | -- | Additional CSS classes on the `<th>`. |

### Table.Head / Table.Body / Table.Cell

Standard `ComponentPropsWithRef` for their respective HTML elements (`<thead>`, `<tbody>`, `<td>`). Accept `className` for overrides.

## Density

Density controls padding and font size on both `Table.HeaderCell` and `Table.Cell`:

| Density | Padding | Font Size |
| --- | --- | --- |
| `dense` | `4px 12px` | `--BodyText-2` |
| `comfortable` | `10px 16px` | `--BodyText-1` |
| `spacious` | `16px 16px` | `--BodyText-1` |

## Sorting

When `onSort` is provided on a `Table.HeaderCell`:

- The cell gets `cursor: pointer`, `user-select: none`, and hover/active/focus-visible styles.
- A sort icon is rendered after the cell content:
  - `ArrowUpDown` (muted) when `sortDirection` is `false` or not the active sort column.
  - `ArrowUp` (accent) when `sortDirection` is `"asc"`.
  - `ArrowDown` (accent) when `sortDirection` is `"desc"`.
- Keyboard: `Enter` and `Space` trigger the sort callback.
- `aria-sort` is set to `"ascending"`, `"descending"`, or `"none"` as appropriate.

## Accessibility

- Sortable header cells have `tabIndex={0}` and respond to `Enter`/`Space`.
- `aria-sort` reflects the current sort direction on sortable columns.
- `prefers-reduced-motion: reduce` disables hover transitions on sortable headers.

## Usage

### Basic

```tsx
import { Table } from "@/web/components/ui/Table";

<Table>
  <Table.Head>
    <Table.Row>
      <Table.HeaderCell>Name</Table.HeaderCell>
      <Table.HeaderCell>Email</Table.HeaderCell>
    </Table.Row>
  </Table.Head>
  <Table.Body>
    <Table.Row>
      <Table.Cell>Alice</Table.Cell>
      <Table.Cell>alice@example.com</Table.Cell>
    </Table.Row>
  </Table.Body>
</Table>
```

### Dense + Striped

```tsx
<Table density="dense" striped>
  <Table.Head>
    <Table.Row>
      <Table.HeaderCell>ID</Table.HeaderCell>
      <Table.HeaderCell>Value</Table.HeaderCell>
    </Table.Row>
  </Table.Head>
  <Table.Body>
    <Table.Row><Table.Cell>1</Table.Cell><Table.Cell>100</Table.Cell></Table.Row>
    <Table.Row><Table.Cell>2</Table.Cell><Table.Cell>200</Table.Cell></Table.Row>
    <Table.Row><Table.Cell>3</Table.Cell><Table.Cell>300</Table.Cell></Table.Row>
  </Table.Body>
</Table>
```

### Sortable Headers

```tsx
const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

<Table>
  <Table.Head>
    <Table.Row>
      <Table.HeaderCell
        sortDirection={sort?.key === "name" ? sort.dir : false}
        onSort={() => handleSort("name")}
      >
        Name
      </Table.HeaderCell>
      <Table.HeaderCell>Email</Table.HeaderCell>
    </Table.Row>
  </Table.Head>
  {/* ... */}
</Table>
```

### Sticky Header

```tsx
<Table stickyHeader>
  {/* Long scrollable table content */}
</Table>
```

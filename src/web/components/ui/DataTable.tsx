import { type ReactNode, useMemo, useState } from "react";

import { Checkbox } from "../form/Checkbox";
import { EmptyState, EmptyStateDescription, EmptyStateTitle } from "./EmptyState";
import { Pagination } from "./Pagination";
import { Skeleton } from "./Skeleton";
import { Table } from "./Table";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ColumnDef<T> {
  key: string;
  header: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  sortable?: boolean;
  width?: string | number;
  align?: "left" | "center" | "right";
  /** Additional CSS class applied to both the header and body cells (e.g. responsive visibility) */
  className?: string;
}

type SortState = { key: string; direction: "asc" | "desc" };

type DataTableProps<T> = {
  // Data
  data: T[];
  columns: ColumnDef<T>[];
  rowKey: (row: T, index: number) => string | number;

  // Sorting (controlled/uncontrolled)
  sort?: SortState;
  onSortChange?: (sort: SortState | null) => void;
  sortComparator?: (a: T, b: T, columnKey: string, direction: "asc" | "desc") => number;

  // Selection
  selectable?: boolean;
  selectedKeys?: Set<string | number>;
  onSelectionChange?: (keys: Set<string | number>) => void;

  // Pagination
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;

  // Display
  density?: "dense" | "comfortable" | "spacious";
  striped?: boolean;
  stickyHeader?: boolean;

  // Loading
  loading?: boolean;
  loadingRowCount?: number;

  // Empty state
  emptyContent?: ReactNode;

  // Row customization
  rowClassName?: (row: T, index: number) => string;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function cellToString(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return "";
}

/* ------------------------------------------------------------------ */
/*  Default sort comparator                                            */
/* ------------------------------------------------------------------ */

function defaultComparator<T>(a: T, b: T, columnKey: string, direction: "asc" | "desc"): number {
  const aVal = (a as Record<string, unknown>)[columnKey];
  const bVal = (b as Record<string, unknown>)[columnKey];

  let result: number;
  if (typeof aVal === "number" && typeof bVal === "number") {
    result = aVal - bVal;
  } else {
    result = cellToString(aVal).localeCompare(cellToString(bVal));
  }

  return direction === "desc" ? -result : result;
}

/* ------------------------------------------------------------------ */
/*  DataTable                                                          */
/* ------------------------------------------------------------------ */

/**
 * Generic data table with sorting, selection, pagination, loading, and empty states.
 *
 * When pagination is server-side (page/totalPages provided without client data slicing),
 * sorting should use controlled mode via the `sort` and `onSortChange` props.
 */
export function DataTable<T>({
  data,
  columns,
  rowKey,
  sort: sortProp,
  onSortChange,
  sortComparator,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  page,
  totalPages,
  onPageChange,
  density = "comfortable",
  striped = false,
  stickyHeader = false,
  loading = false,
  loadingRowCount = 5,
  emptyContent,
  rowClassName,
}: DataTableProps<T>) {
  // Uncontrolled sort state
  const [internalSort, setInternalSort] = useState<SortState | null>(null);
  const isControlledSort = sortProp !== undefined;
  const currentSort = isControlledSort ? sortProp : internalSort;

  function handleSort(columnKey: string) {
    let next: SortState | null;
    if (!currentSort || currentSort.key !== columnKey) {
      next = { key: columnKey, direction: "asc" };
    } else if (currentSort.direction === "asc") {
      next = { key: columnKey, direction: "desc" };
    } else {
      next = null;
    }

    if (isControlledSort) {
      onSortChange?.(next);
    } else {
      setInternalSort(next);
      onSortChange?.(next);
    }
  }

  // Sort data (only for client-side / uncontrolled)
  const sortedData = useMemo(() => {
    if (!currentSort) return data;
    // If sort is controlled, assume server handles sorting
    if (isControlledSort) return data;
    const comparator = sortComparator ?? defaultComparator;
    return [...data].sort((a, b) =>
      comparator(a, b, currentSort.key, currentSort.direction)
    );
  }, [data, currentSort, isControlledSort, sortComparator]);

  // Selection helpers
  const visibleKeys = useMemo(
    () => sortedData.map((row, i) => rowKey(row, i)),
    [sortedData, rowKey]
  );
  const allSelected = selectedKeys != null && visibleKeys.length > 0 && visibleKeys.every((k) => selectedKeys.has(k));
  const someSelected = selectedKeys != null && visibleKeys.some((k) => selectedKeys.has(k));

  function handleSelectAll() {
    if (!onSelectionChange || !selectedKeys) return;
    if (allSelected) {
      const next = new Set(selectedKeys);
      for (const k of visibleKeys) next.delete(k);
      onSelectionChange(next);
    } else {
      const next = new Set(selectedKeys);
      for (const k of visibleKeys) next.add(k);
      onSelectionChange(next);
    }
  }

  function handleSelectRow(key: string | number) {
    if (!onSelectionChange || !selectedKeys) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onSelectionChange(next);
  }

  // Column count (including selection checkbox column)
  const totalColumns = columns.length + (selectable ? 1 : 0);

  // Render loading skeleton
  if (loading) {
    return (
      <Table density={density} striped={false} stickyHeader={stickyHeader}>
        <Table.Head>
          <Table.Row>
            {selectable && <Table.HeaderCell style={{ width: 40 }} />}
            {columns.map((col) => (
              <Table.HeaderCell key={col.key} className={col.className} style={{ width: col.width }}>
                {col.header}
              </Table.HeaderCell>
            ))}
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {Array.from({ length: loadingRowCount }, (_, i) => (
            <Table.Row key={i}>
              {selectable && (
                <Table.Cell>
                  <Skeleton variant="rectangular" width={16} height={16} />
                </Table.Cell>
              )}
              {columns.map((col) => (
                <Table.Cell key={col.key} className={col.className}>
                  <Skeleton variant="text" />
                </Table.Cell>
              ))}
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    );
  }

  // Render empty state
  if (data.length === 0) {
    return (
      <div>
        <Table density={density} striped={false} stickyHeader={stickyHeader}>
          <Table.Head>
            <Table.Row>
              {selectable && <Table.HeaderCell style={{ width: 40 }} />}
              {columns.map((col) => (
                <Table.HeaderCell key={col.key} className={col.className} style={{ width: col.width }}>
                  {col.header}
                </Table.HeaderCell>
              ))}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            <Table.Row>
              <Table.Cell colSpan={totalColumns}>
                {emptyContent ?? (
                  <EmptyState size="md">
                    <EmptyStateTitle>No data</EmptyStateTitle>
                    <EmptyStateDescription>There are no items to display.</EmptyStateDescription>
                  </EmptyState>
                )}
              </Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table>
      </div>
    );
  }

  // Render data
  return (
    <div>
      <Table density={density} striped={striped} stickyHeader={stickyHeader}>
        <Table.Head>
          <Table.Row>
            {selectable && (
              <Table.HeaderCell style={{ width: 40 }}>
                <Checkbox
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={handleSelectAll}
                  aria-label="Select all rows"
                />
              </Table.HeaderCell>
            )}
            {columns.map((col) => (
              <Table.HeaderCell
                key={col.key}
                className={col.className}
                style={{
                  width: col.width,
                  textAlign: col.align,
                }}
                sortDirection={
                  col.sortable
                    ? currentSort?.key === col.key
                      ? currentSort.direction
                      : false
                    : undefined
                }
                onSort={col.sortable ? () => handleSort(col.key) : undefined}
              >
                {col.header}
              </Table.HeaderCell>
            ))}
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {sortedData.map((row, i) => {
            const key = rowKey(row, i);
            return (
              <Table.Row key={key} selected={selectedKeys?.has(key)} className={rowClassName?.(row, i)}>
                {selectable && (
                  <Table.Cell>
                    <Checkbox
                      checked={selectedKeys?.has(key) ?? false}
                      onChange={() => handleSelectRow(key)}
                      aria-label={`Select row ${key}`}
                    />
                  </Table.Cell>
                )}
                {columns.map((col) => (
                  <Table.Cell key={col.key} className={col.className} style={{ textAlign: col.align }}>
                    {col.render ? col.render(row, i) : cellToString((row as Record<string, unknown>)[col.key])}
                  </Table.Cell>
                ))}
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>

      {page != null && totalPages != null && onPageChange && (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
          />
        </div>
      )}
    </div>
  );
}

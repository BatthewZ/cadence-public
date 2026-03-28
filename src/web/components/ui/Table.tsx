import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  type ComponentPropsWithRef,
  createContext,
  forwardRef,
  type ReactNode,
  useContext,
} from "react";

import { cn } from "@/web/util/style/style";

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

type Density = "dense" | "comfortable" | "spacious";

type TableContextValue = {
  density: Density;
  striped: boolean;
};

const TableContext = createContext<TableContextValue | null>(null);

function useTableContext() {
  const ctx = useContext(TableContext);
  if (!ctx) throw new Error("Table compound components must be used within <Table>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Density class helper                                               */
/* ------------------------------------------------------------------ */

const densityClassMap: Record<Density, string> = {
  dense: "table-cell--dense",
  comfortable: "table-cell--comfortable",
  spacious: "table-cell--spacious",
};

/* ------------------------------------------------------------------ */
/*  Table (root)                                                       */
/* ------------------------------------------------------------------ */

type TableProps = {
  density?: Density;
  striped?: boolean;
  stickyHeader?: boolean;
} & ComponentPropsWithRef<"div">;

const TableRoot = forwardRef<HTMLDivElement, TableProps>(function Table(
  { density = "comfortable", striped = false, stickyHeader = false, className, children, ...props },
  ref
) {
  return (
    <TableContext.Provider value={{ density, striped }}>
      <div ref={ref} className={cn("table-wrapper", className)} {...props}>
        <table
          className={cn("table", stickyHeader && "table--sticky-header")}
        >
          {children}
        </table>
      </div>
    </TableContext.Provider>
  );
});

/* ------------------------------------------------------------------ */
/*  Table.Head                                                         */
/* ------------------------------------------------------------------ */

type TableHeadProps = ComponentPropsWithRef<"thead">;

const TableHead = forwardRef<HTMLTableSectionElement, TableHeadProps>(
  function TableHead({ className, ...props }, ref) {
    useTableContext();
    return <thead ref={ref} className={cn("table-head", className)} {...props} />;
  }
);

/* ------------------------------------------------------------------ */
/*  Table.Body                                                         */
/* ------------------------------------------------------------------ */

type TableBodyProps = ComponentPropsWithRef<"tbody">;

const TableBody = forwardRef<HTMLTableSectionElement, TableBodyProps>(
  function TableBody({ className, ...props }, ref) {
    useTableContext();
    return <tbody ref={ref} className={cn("table-body", className)} {...props} />;
  }
);

/* ------------------------------------------------------------------ */
/*  Table.Row                                                          */
/* ------------------------------------------------------------------ */

type TableRowProps = {
  selected?: boolean;
} & ComponentPropsWithRef<"tr">;

const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
  function TableRow({ selected = false, className, ...props }, ref) {
    const { striped } = useTableContext();
    return (
      <tr
        ref={ref}
        className={cn(
          "table-row",
          selected && "table-row--selected",
          striped && "table-row--striped",
          className
        )}
        {...props}
      />
    );
  }
);

/* ------------------------------------------------------------------ */
/*  Table.HeaderCell                                                   */
/* ------------------------------------------------------------------ */

type TableHeaderCellProps = {
  sortDirection?: "asc" | "desc" | false;
  onSort?: () => void;
} & ComponentPropsWithRef<"th">;

const TableHeaderCell = forwardRef<HTMLTableCellElement, TableHeaderCellProps>(
  function TableHeaderCell({ sortDirection, onSort, className, children, ...props }, ref) {
    const { density } = useTableContext();
    const sortable = !!onSort;

    let sortIcon: ReactNode = null;
    if (sortable) {
      const Icon = sortDirection === "asc" ? ArrowUp : sortDirection === "desc" ? ArrowDown : ArrowUpDown;
      const modifier = sortDirection ? "active" : "muted";
      sortIcon = (
        <span className={`table-header-cell__sort-icon table-header-cell__sort-icon--${modifier}`}>
          <Icon size={14} />
        </span>
      );
    }

    return (
      <th
        ref={ref}
        className={cn(
          "table-header-cell",
          densityClassMap[density],
          sortable && "table-header-cell--sortable",
          className
        )}
        onClick={onSort}
        onKeyDown={
          sortable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSort?.();
                }
              }
            : undefined
        }
        tabIndex={sortable ? 0 : undefined}
        aria-sort={
          sortDirection === "asc"
            ? "ascending"
            : sortDirection === "desc"
              ? "descending"
              : sortable
                ? "none"
                : undefined
        }
        {...props}
      >
        {children}
        {sortIcon}
      </th>
    );
  }
);

/* ------------------------------------------------------------------ */
/*  Table.Cell                                                         */
/* ------------------------------------------------------------------ */

type TableCellProps = ComponentPropsWithRef<"td">;

const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(
  function TableCell({ className, ...props }, ref) {
    const { density } = useTableContext();
    return (
      <td
        ref={ref}
        className={cn("table-cell", densityClassMap[density], className)}
        {...props}
      />
    );
  }
);

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

export const Table = Object.assign(TableRoot, {
  Head: TableHead,
  Body: TableBody,
  Row: TableRow,
  HeaderCell: TableHeaderCell,
  Cell: TableCell,
});

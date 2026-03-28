import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { type ColumnDef,DataTable } from "./DataTable";

type Item = { id: number; name: string; age: number };

const columns: ColumnDef<Item>[] = [
  { key: "name", header: "Name" },
  { key: "age", header: "Age" },
];

const data: Item[] = [
  { id: 1, name: "Alice", age: 30 },
  { id: 2, name: "Bob", age: 25 },
];

const rowKey = (row: Item) => row.id;

describe("DataTable", () => {
  it("renders column headers from column definitions", () => {
    render(<DataTable data={data} columns={columns} rowKey={rowKey} />);

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Age")).toBeInTheDocument();
  });

  it("renders row data", () => {
    render(<DataTable data={data} columns={columns} rowKey={rowKey} />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
  });

  it("uses custom render function on column", () => {
    const customColumns: ColumnDef<Item>[] = [
      {
        key: "name",
        header: "Name",
        render: (row) => <strong>{row.name.toUpperCase()}</strong>,
      },
      { key: "age", header: "Age" },
    ];

    render(<DataTable data={data} columns={customColumns} rowKey={rowKey} />);

    expect(screen.getByText("ALICE")).toBeInTheDocument();
    expect(screen.getByText("BOB")).toBeInTheDocument();
  });

  it("clicking sortable header calls onSortChange", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();

    const sortableColumns: ColumnDef<Item>[] = [
      { key: "name", header: "Name", sortable: true },
      { key: "age", header: "Age" },
    ];

    render(
      <DataTable
        data={data}
        columns={sortableColumns}
        rowKey={rowKey}
        onSortChange={onSortChange}
      />,
    );

    await user.click(screen.getByText("Name"));
    expect(onSortChange).toHaveBeenCalledWith({ key: "name", direction: "asc" });
  });

  it("renders checkboxes when selectable=true", () => {
    render(
      <DataTable
        data={data}
        columns={columns}
        rowKey={rowKey}
        selectable
        selectedKeys={new Set()}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: /select all rows/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /select row 1/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /select row 2/i }),
    ).toBeInTheDocument();
  });

  it("select all checkbox selects all rows", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    render(
      <DataTable
        data={data}
        columns={columns}
        rowKey={rowKey}
        selectable
        selectedKeys={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", { name: /select all rows/i }),
    );
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([1, 2]));
  });

  it("individual row checkbox calls onSelectionChange", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    render(
      <DataTable
        data={data}
        columns={columns}
        rowKey={rowKey}
        selectable
        selectedKeys={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", { name: /select row 1/i }),
    );
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([1]));
  });

  it("renders Pagination when page and totalPages are provided", () => {
    render(
      <DataTable
        data={data}
        columns={columns}
        rowKey={rowKey}
        page={1}
        totalPages={5}
        onPageChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: /pagination/i }),
    ).toBeInTheDocument();
  });

  it("shows skeleton rows when loading=true", () => {
    render(
      <DataTable
        data={[]}
        columns={columns}
        rowKey={rowKey}
        loading
        loadingRowCount={3}
      />,
    );

    const skeletons = screen.getAllByRole("status", { name: /loading/i });
    expect(skeletons).toHaveLength(6);
  });

  it("shows 'No data' EmptyState when data is empty", () => {
    render(<DataTable data={[]} columns={columns} rowKey={rowKey} />);

    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("shows custom emptyContent when provided", () => {
    render(
      <DataTable
        data={[]}
        columns={columns}
        rowKey={rowKey}
        emptyContent={<div>Nothing to see here</div>}
      />,
    );

    expect(screen.getByText("Nothing to see here")).toBeInTheDocument();
  });
});

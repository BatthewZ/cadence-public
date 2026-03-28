import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Table } from "./Table";

describe("Table", () => {
  it("renders a <table> element", () => {
    render(
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Header</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Cell</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("table");
  });

  it("Table.Head renders <thead> and Table.Body renders <tbody>", () => {
    render(
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Header</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Cell</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    const rowgroups = screen.getAllByRole("rowgroup");
    expect(rowgroups.length).toBe(2);
    const thead = screen.getByRole("table").querySelector("thead");
    expect(thead).toBeInTheDocument();
    expect(thead).toHaveClass("table-head");

    const tbody = screen.getByRole("table").querySelector("tbody");
    expect(tbody).toBeInTheDocument();
    expect(tbody).toHaveClass("table-body");
  });

  it("Table.Row renders <tr>, Table.Cell renders <td>, Table.HeaderCell renders <th>", () => {
    render(
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Header</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Cell</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    const rows = screen.getAllByRole("row");
    expect(rows.length).toBe(2);
    expect(rows[0]).toHaveClass("table-row");

    expect(screen.getByRole("columnheader")).toBeInTheDocument();
    expect(screen.getByRole("columnheader")).toHaveClass("table-header-cell");

    expect(screen.getByRole("cell")).toBeInTheDocument();
    expect(screen.getByRole("cell")).toHaveClass("table-cell");
  });

  it("stickyHeader prop adds 'table--sticky-header' class to <table> element", () => {
    render(
      <Table stickyHeader>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Header</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Cell</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    expect(screen.getByRole("table")).toHaveClass("table--sticky-header");
  });

  it("striped prop causes rows to get 'table-row--striped' class", () => {
    render(
      <Table striped>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Header</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Row 1</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell>Row 2</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    const rows = screen.getAllByRole("row");
    const bodyRows = rows.filter((row) => row.closest("tbody"));
    const hasStripedClass = bodyRows.some((row) =>
      row.classList.contains("table-row--striped"),
    );
    expect(hasStripedClass).toBe(true);
  });

  it("HeaderCell with sortDirection='asc' has aria-sort='ascending'", () => {
    render(
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell sortDirection="asc" onSort={vi.fn()}>
              Name
            </Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Cell</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    expect(screen.getByRole("columnheader")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  it("HeaderCell with sortDirection='desc' has aria-sort='descending'", () => {
    render(
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell sortDirection="desc" onSort={vi.fn()}>
              Name
            </Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Cell</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    expect(screen.getByRole("columnheader")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("HeaderCell onSort callback fires on click", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();

    render(
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell sortDirection={false} onSort={onSort}>
              Name
            </Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Cell</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    await user.click(screen.getByRole("columnheader"));
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it("Row selected prop applies 'table-row--selected' class", () => {
    render(
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Header</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row selected>
            <Table.Cell>Selected Row</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell>Normal Row</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    const rows = screen.getAllByRole("row");
    const bodyRows = rows.filter((row) => row.closest("tbody"));
    expect(bodyRows[0]).toHaveClass("table-row--selected");
    expect(bodyRows[1]).not.toHaveClass("table-row--selected");
  });

  it("forwards className on root wrapper", () => {
    const { container } = render(
      <Table className="custom-class">
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Header</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Cell</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );

    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveClass("table-wrapper");
    expect(wrapper).toHaveClass("custom-class");
  });
});

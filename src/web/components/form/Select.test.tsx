import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Select } from "./Select";

describe("Select", () => {
  it("renders a select element", () => {
    render(
      <Select aria-label="Country">
        <option value="us">US</option>
      </Select>
    );
    expect(screen.getByRole("combobox", { name: "Country" })).toBeInTheDocument();
  });

  it("renders children options", () => {
    render(
      <Select aria-label="Country">
        <option value="us">United States</option>
        <option value="ca">Canada</option>
        <option value="mx">Mexico</option>
      </Select>
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("United States");
    expect(options[1]).toHaveTextContent("Canada");
    expect(options[2]).toHaveTextContent("Mexico");
  });

  it("applies base text classes", () => {
    render(
      <Select aria-label="Country">
        <option>US</option>
      </Select>
    );
    const select = screen.getByRole("combobox", { name: "Country" });
    expect(select.className).toContain("text-body-2");
  });

  it("applies error styling when error is true", () => {
    render(
      <Select error aria-label="Country">
        <option>US</option>
      </Select>
    );
    const select = screen.getByRole("combobox", { name: "Country" });
    expect(select.className).toContain("border-status-error");
    expect(select).toHaveAttribute("aria-invalid", "true");
  });

  it("does not apply error styling when error is false", () => {
    render(
      <Select aria-label="Country">
        <option>US</option>
      </Select>
    );
    const select = screen.getByRole("combobox", { name: "Country" });
    expect(select.className).not.toContain("border-status-error");
    expect(select).not.toHaveAttribute("aria-invalid");
  });

  it("renders as disabled", () => {
    render(
      <Select disabled aria-label="Country">
        <option>US</option>
      </Select>
    );
    expect(screen.getByRole("combobox", { name: "Country" })).toBeDisabled();
  });

  it("forwards ref to the select element", () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <Select ref={ref} aria-label="Country">
        <option>US</option>
      </Select>
    );
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
    expect(ref.current).toBe(screen.getByRole("combobox", { name: "Country" }));
  });

  it("calls onChange when selection changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select aria-label="Country" onChange={onChange}>
        <option value="us">United States</option>
        <option value="ca">Canada</option>
      </Select>
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Country" }), "ca");
    expect(onChange).toHaveBeenCalled();
  });

  it("merges custom className with default classes", () => {
    render(
      <Select className="custom-select" aria-label="Country">
        <option>US</option>
      </Select>
    );
    const select = screen.getByRole("combobox", { name: "Country" });
    expect(select.className).toContain("custom-select");
    expect(select.className).toContain("text-body-2");
  });

  it("applies custom appearance styling", () => {
    render(
      <Select aria-label="Country">
        <option>US</option>
      </Select>
    );
    const select = screen.getByRole("combobox", { name: "Country" });
    expect(select.className).toContain("appearance-none");
  });
});

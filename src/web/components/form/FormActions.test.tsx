import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { FormActions } from "./FormActions";

describe("FormActions", () => {
  it("renders children", () => {
    render(
      <FormActions>
        <button>Save</button>
        <button>Cancel</button>
      </FormActions>
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("applies flex layout classes", () => {
    render(
      <FormActions data-testid="actions">
        <button>Submit</button>
      </FormActions>
    );
    const container = screen.getByTestId("actions");
    expect(container.className).toContain("flex");
    expect(container.className).toContain("flex-row");
    expect(container.className).toContain("justify-end");
    expect(container.className).toContain("gap-r5");
    expect(container.className).toContain("pt-r4");
  });

  it("merges custom className with default classes", () => {
    render(
      <FormActions className="custom-actions" data-testid="actions">
        <button>Submit</button>
      </FormActions>
    );
    const container = screen.getByTestId("actions");
    expect(container.className).toContain("custom-actions");
    expect(container.className).toContain("flex");
  });

  it("forwards ref to the div element", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <FormActions ref={ref} data-testid="actions">
        <button>Submit</button>
      </FormActions>
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toBe(screen.getByTestId("actions"));
  });

  it("renders as a div element", () => {
    render(
      <FormActions data-testid="actions">
        <button>Submit</button>
      </FormActions>
    );
    expect(screen.getByTestId("actions").tagName).toBe("DIV");
  });

  it("passes additional HTML props", () => {
    render(
      <FormActions data-testid="actions" id="form-actions">
        <button>Submit</button>
      </FormActions>
    );
    expect(screen.getByTestId("actions")).toHaveAttribute("id", "form-actions");
  });

  it("renders with no children", () => {
    render(<FormActions data-testid="actions" />);
    expect(screen.getByTestId("actions")).toBeInTheDocument();
    expect(screen.getByTestId("actions").children).toHaveLength(0);
  });
});

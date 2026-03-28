import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field } from "./Field";
import { FieldError } from "./FieldError";
import { Input } from "./Input";
import { Select } from "./Select";
import { Textarea } from "./Textarea";

describe("Field aria-describedby wiring", () => {
  it("links Input to FieldError via aria-describedby when error is present", () => {
    render(
      <Field>
        <Input error placeholder="Email" />
        <FieldError>Email is required</FieldError>
      </Field>
    );

    const input = screen.getByPlaceholderText("Email");
    const error = screen.getByRole("alert");

    expect(error).toHaveAttribute("id");
    expect(input).toHaveAttribute("aria-describedby", error.getAttribute("id"));
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("does not set aria-describedby when error is false", () => {
    render(
      <Field>
        <Input placeholder="Email" />
        <FieldError>Email is required</FieldError>
      </Field>
    );

    const input = screen.getByPlaceholderText("Email");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("links Textarea to FieldError via aria-describedby when error is present", () => {
    render(
      <Field>
        <Textarea error placeholder="Bio" />
        <FieldError>Bio is required</FieldError>
      </Field>
    );

    const textarea = screen.getByPlaceholderText("Bio");
    const error = screen.getByRole("alert");

    expect(error).toHaveAttribute("id");
    expect(textarea).toHaveAttribute("aria-describedby", error.getAttribute("id"));
  });

  it("links Select to FieldError via aria-describedby when error is present", () => {
    render(
      <Field>
        <Select error aria-label="Country">
          <option>US</option>
        </Select>
        <FieldError>Country is required</FieldError>
      </Field>
    );

    const select = screen.getByRole("combobox", { name: "Country" });
    const error = screen.getByRole("alert");

    expect(error).toHaveAttribute("id");
    expect(select).toHaveAttribute("aria-describedby", error.getAttribute("id"));
  });

  it("FieldError renders without id when outside Field context", () => {
    render(<FieldError>Some error</FieldError>);

    const error = screen.getByRole("alert");
    expect(error).not.toHaveAttribute("id");
  });

  it("Input works without Field context (no aria-describedby)", () => {
    render(<Input error placeholder="Standalone" />);

    const input = screen.getByPlaceholderText("Standalone");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("respects explicit id prop on FieldError", () => {
    render(
      <Field>
        <Input error placeholder="Name" />
        <FieldError id="custom-error-id">Name is required</FieldError>
      </Field>
    );

    const error = screen.getByRole("alert");
    expect(error).toHaveAttribute("id", "custom-error-id");
  });
});

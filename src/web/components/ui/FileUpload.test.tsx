import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { FileUpload } from "./FileUpload";

describe("FileUpload", () => {
  it("renders dropzone area with button role", () => {
    render(<FileUpload />);
    expect(screen.getByRole("button", { name: "Upload file" })).toBeInTheDocument();
  });

  it("renders drag & drop text", () => {
    render(<FileUpload />);
    expect(screen.getByText(/drag & drop/i)).toBeInTheDocument();
    expect(screen.getByText("browse")).toBeInTheDocument();
  });

  it("click opens file picker (clicking triggers hidden input)", async () => {
    const user = userEvent.setup();
    render(<FileUpload />);

    const inputEl = document.querySelector("input[type='file']") as HTMLInputElement;
    const clickSpy = vi.spyOn(inputEl, "click");

    await user.click(screen.getByRole("button", { name: "Upload file" }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it("shows max size text when maxSize is provided", () => {
    render(<FileUpload maxSize={5 * 1024 * 1024} />);
    expect(screen.getByText("Max file size: 5.0 MB")).toBeInTheDocument();
  });

  it("shows custom hint text", () => {
    render(<FileUpload hint="Only PNG files" />);
    expect(screen.getByText("Only PNG files")).toBeInTheDocument();
  });

  it("displays error message when present", () => {
    render(<FileUpload error="File too large" />);
    expect(screen.getByText("File too large")).toBeInTheDocument();
  });

  it("hides hint when error is present", () => {
    render(<FileUpload maxSize={1024} error="Something went wrong" />);
    expect(screen.queryByText(/max file size/i)).not.toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("displays success message when present", () => {
    render(<FileUpload success="Upload complete!" />);
    expect(screen.getByText("Upload complete!")).toBeInTheDocument();
  });

  it("disabled state sets aria-disabled", () => {
    render(<FileUpload disabled />);
    expect(screen.getByRole("button", { name: "Upload file" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("disabled state prevents file picker from opening", async () => {
    const user = userEvent.setup();
    render(<FileUpload disabled />);

    const inputEl = document.querySelector("input[type='file']") as HTMLInputElement;
    const clickSpy = vi.spyOn(inputEl, "click");

    await user.click(screen.getByRole("button", { name: "Upload file" }));
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("disabled state sets tabIndex to -1", () => {
    render(<FileUpload disabled />);
    expect(screen.getByRole("button", { name: "Upload file" })).toHaveAttribute("tabindex", "-1");
  });

  it("forwards className prop", () => {
    render(<FileUpload className="custom-upload" />);
    const dropzone = screen.getByRole("button", { name: "Upload file" });
    expect(dropzone.className).toContain("custom-upload");
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLDivElement>();
    render(<FileUpload ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it("shows uploading state text", () => {
    render(<FileUpload uploading />);
    expect(screen.getByText("Uploading...")).toBeInTheDocument();
    expect(screen.queryByText(/drag & drop/i)).not.toBeInTheDocument();
  });

  it("applies accept attribute to hidden input", () => {
    render(<FileUpload accept={["image/png", "image/jpeg"]} />);
    const inputEl = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(inputEl).toHaveAttribute("accept", "image/png,image/jpeg");
  });

  it("sets multiple attribute on hidden input", () => {
    render(<FileUpload multiple />);
    const inputEl = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(inputEl).toHaveAttribute("multiple");
  });

  it("disables hidden input when disabled", () => {
    render(<FileUpload disabled />);
    const inputEl = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(inputEl).toBeDisabled();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarUpload } from "./AvatarUpload";

// Mock the useFileUpload hook
vi.mock("@/web/hooks/use-file-upload", () => ({
  useFileUpload: () => ({
    state: mockState,
    upload: mockUpload,
    validate: mockValidate,
    error: mockError,
    data: null,
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

let mockState = "idle" as string;
let mockUpload = vi.fn();
let mockValidate = vi.fn().mockReturnValue(null);
let mockError: string | null = null;

describe("AvatarUpload", () => {
  beforeEach(() => {
    mockState = "idle";
    mockUpload = vi.fn().mockResolvedValue(null);
    mockValidate = vi.fn().mockReturnValue(null);
    mockError = null;
  });

  it("renders avatar placeholder when no image", () => {
    render(<AvatarUpload name="Jane Doe" />);
    const avatar = screen.getByRole("img", { name: "Jane Doe" });
    expect(avatar).toBeInTheDocument();
  });

  it("renders with button role and accessible label", () => {
    render(<AvatarUpload />);
    expect(screen.getByRole("button", { name: "Change avatar" })).toBeInTheDocument();
  });

  it("shows current avatar image when provided", () => {
    render(<AvatarUpload src="https://example.com/avatar.jpg" name="Jane Doe" />);
    // The Avatar component renders a <span role="img"> wrapping an <img> element
    const imgs = screen.getAllByRole("img", { name: "Jane Doe" });
    expect(imgs.length).toBeGreaterThanOrEqual(1);
    // Find the actual <img> element with the src attribute
    const imgEl = document.querySelector("img[src='https://example.com/avatar.jpg']");
    expect(imgEl).toBeInTheDocument();
  });

  it("click triggers file selection", async () => {
    const user = userEvent.setup();
    render(<AvatarUpload />);

    const inputEl = document.querySelector("input[type='file']") as HTMLInputElement;
    const clickSpy = vi.spyOn(inputEl, "click");

    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it("shows loading state during upload", () => {
    mockState = "uploading";
    render(<AvatarUpload />);
    // When uploading, a spinner element is rendered (animate-spin class)
    const button = screen.getByRole("button", { name: "Change avatar" });
    const spinner = button.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("forwards className prop", () => {
    render(<AvatarUpload className="custom-avatar" />);
    const button = screen.getByRole("button", { name: "Change avatar" });
    expect(button.className).toContain("custom-avatar");
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLDivElement>();
    render(<AvatarUpload ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it("has a hidden file input with image accept types", () => {
    render(<AvatarUpload />);
    const inputEl = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(inputEl).toBeInTheDocument();
    expect(inputEl.getAttribute("accept")).toBeTruthy();
  });

  it("displays error when upload fails", () => {
    mockError = "Upload failed";
    render(<AvatarUpload />);
    expect(screen.getByRole("alert")).toHaveTextContent("Upload failed");
  });
});

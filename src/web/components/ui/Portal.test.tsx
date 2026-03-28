import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Portal } from "./Portal";

describe("Portal", () => {
  it("renders children into document.body by default", () => {
    render(
      <Portal>
        <span data-testid="portal-child">Hello</span>
      </Portal>
    );

    // The child should be in the document body, not inside the React root container
    expect(screen.getByTestId("portal-child")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();

    // Verify it's rendered as a direct child of body (not inside the test container)
    const child = screen.getByTestId("portal-child");
    expect(child.closest("body")).toBe(document.body);
  });

  it("renders children into a custom container", () => {
    const container = document.createElement("div");
    container.setAttribute("id", "custom-portal-root");
    document.body.appendChild(container);

    render(
      <Portal container={container}>
        <span data-testid="custom-child">Custom</span>
      </Portal>
    );

    const child = screen.getByTestId("custom-child");
    expect(child.parentElement).toBe(container);

    document.body.removeChild(container);
  });

  it("removes children from the DOM on unmount", () => {
    const { unmount } = render(
      <Portal>
        <span data-testid="removable">Temp</span>
      </Portal>
    );

    expect(screen.getByTestId("removable")).toBeInTheDocument();

    unmount();

    expect(screen.queryByTestId("removable")).not.toBeInTheDocument();
  });

  it("renders interactive children that respond to events", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Portal>
        <button onClick={onClick}>Portal Button</button>
      </Portal>
    );

    const button = screen.getByRole("button", { name: "Portal Button" });
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders multiple children", () => {
    render(
      <Portal>
        <span data-testid="first">First</span>
        <span data-testid="second">Second</span>
      </Portal>
    );

    expect(screen.getByTestId("first")).toBeInTheDocument();
    expect(screen.getByTestId("second")).toBeInTheDocument();
  });

  it("falls back to body when container is null", () => {
    render(
      <Portal container={null}>
        <span data-testid="fallback-child">Fallback</span>
      </Portal>
    );

    expect(screen.getByTestId("fallback-child")).toBeInTheDocument();
    expect(screen.getByTestId("fallback-child").closest("body")).toBe(document.body);
  });
});

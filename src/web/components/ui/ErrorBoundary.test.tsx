import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

// A component that throws on demand
function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error");
  }
  return <div>Normal content</div>;
}

// Suppress console.error for expected error boundary triggers
function suppressConsoleError() {
  const original = console.error;
  console.error = vi.fn();
  return () => {
    console.error = original;
  };
}

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <div>Safe content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText("Safe content")).toBeInTheDocument();
  });

  it("does not show fallback UI when there is no error", () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>
    );

    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("catches errors and shows fallback UI", () => {
    const restore = suppressConsoleError();

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("Normal content")).not.toBeInTheDocument();

    restore();
  });

  it("displays the error description in the fallback", () => {
    const restore = suppressConsoleError();

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText("An unexpected error occurred.")).toBeInTheDocument();

    restore();
  });

  it("renders a 'Try again' button in the fallback", () => {
    const restore = suppressConsoleError();

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    restore();
  });

  it("resets and re-renders children when 'Try again' is clicked", async () => {
    const restore = suppressConsoleError();
    const user = userEvent.setup();

    // We need a stateful wrapper to control throw behavior
    let shouldThrow = true;

    function Wrapper() {
      if (shouldThrow) {
        throw new Error("Boom");
      }
      return <div>Recovered content</div>;
    }

    render(
      <ErrorBoundary>
        <Wrapper />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Stop throwing before retrying
    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Recovered content")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();

    restore();
  });

  it("catches errors from deeply nested components", () => {
    const restore = suppressConsoleError();

    function DeepChild(): React.ReactNode {
      throw new Error("Deep error");
    }

    render(
      <ErrorBoundary>
        <div>
          <div>
            <DeepChild />
          </div>
        </div>
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    restore();
  });
});

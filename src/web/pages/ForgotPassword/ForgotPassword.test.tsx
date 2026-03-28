import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRequestPasswordReset = vi.fn();

vi.mock("@/web/lib/auth/auth-client", () => ({
  requestPasswordReset: (
    ...args: unknown[]
  ): Promise<{ error: null | { message?: string } }> =>
    mockRequestPasswordReset(...args) as Promise<{
      error: null | { message?: string };
    }>,
}));

vi.mock("@/web/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
}));

import ForgotPassword from "./ForgotPassword";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderForgotPassword() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  );
  return { user };
}

/**
 * Tests for the ForgotPassword page which allows users to request a
 * password reset link via email.
 *
 * Regressions here would prevent users who have forgotten their password
 * from recovering their accounts, forcing them to contact support.
 */
describe("ForgotPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestPasswordReset.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Initial render
  // -----------------------------------------------------------------------

  it("renders the heading, email input, and submit button", () => {
    renderForgotPassword();

    expect(
      screen.getByRole("heading", { name: "Forgot Password" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send Reset Link" }),
    ).toBeInTheDocument();
  });

  it("renders 'Back to Sign In' link pointing to /login", () => {
    renderForgotPassword();

    const link = screen.getByRole("link", { name: "Back to Sign In" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/login");
  });

  // -----------------------------------------------------------------------
  // 2. Validation
  // -----------------------------------------------------------------------

  it("shows validation error for empty email on submit", async () => {
    const { user } = renderForgotPassword();

    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    await waitFor(() => {
      expect(
        screen.getByText("Please enter a valid email address"),
      ).toBeInTheDocument();
    });

    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });

  it("shows validation error for invalid email format", async () => {
    const { user } = renderForgotPassword();

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    await waitFor(() => {
      expect(
        screen.getByText("Please enter a valid email address"),
      ).toBeInTheDocument();
    });

    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });

  it("clears email validation error when user types in the field", async () => {
    const { user } = renderForgotPassword();

    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    await waitFor(() => {
      expect(
        screen.getByText("Please enter a valid email address"),
      ).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Email"), "a");

    await waitFor(() => {
      expect(
        screen.queryByText("Please enter a valid email address"),
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 3. Successful submission
  // -----------------------------------------------------------------------

  it("calls requestPasswordReset with email and shows success message", async () => {
    const { user } = renderForgotPassword();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    await waitFor(() => {
      expect(mockRequestPasswordReset).toHaveBeenCalledWith({
        email: "alice@test.com",
        redirectTo: "/reset-password",
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "If an account exists with that email, we've sent a password reset link.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("shows 'Back to Sign In' link in success state", async () => {
    const { user } = renderForgotPassword();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "If an account exists with that email, we've sent a password reset link.",
        ),
      ).toBeInTheDocument();
    });

    const link = screen.getByRole("link", { name: "Back to Sign In" });
    expect(link).toHaveAttribute("href", "/login");
  });

  // -----------------------------------------------------------------------
  // 4. Error handling
  // -----------------------------------------------------------------------

  it("displays server-side error from requestPasswordReset response", async () => {
    mockRequestPasswordReset.mockResolvedValue({
      error: { message: "Rate limit exceeded" },
    });
    const { user } = renderForgotPassword();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    await waitFor(() => {
      expect(screen.getByText("Rate limit exceeded")).toBeInTheDocument();
    });
  });

  it("displays fallback error when response error has no message", async () => {
    mockRequestPasswordReset.mockResolvedValue({
      error: { message: undefined },
    });
    const { user } = renderForgotPassword();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to send reset link"),
      ).toBeInTheDocument();
    });
  });

  it("displays network error when requestPasswordReset throws", async () => {
    mockRequestPasswordReset.mockRejectedValue(new Error("Network failure"));
    const { user } = renderForgotPassword();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    await waitFor(() => {
      expect(
        screen.getByText("Network error. Please try again."),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Loading state
  // -----------------------------------------------------------------------

  it("disables submit button and shows loading text during submission", async () => {
    let resolveReset!: (value: { error: null }) => void;
    mockRequestPasswordReset.mockImplementation(
      () =>
        new Promise<{ error: null }>((resolve) => {
          resolveReset = resolve;
        }),
    );

    const { user } = renderForgotPassword();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Sending..." }),
      ).toBeDisabled();
    });

    resolveReset({ error: null });

    await waitFor(() => {
      expect(
        screen.getByText(
          "If an account exists with that email, we've sent a password reset link.",
        ),
      ).toBeInTheDocument();
    });
  });
});

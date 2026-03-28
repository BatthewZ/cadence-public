import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockResetPassword = vi.fn();

vi.mock("@/web/lib/auth/auth-client", () => ({
  resetPassword: (
    ...args: unknown[]
  ): Promise<{ error: null | { message?: string } }> =>
    mockResetPassword(...args) as Promise<{
      error: null | { message?: string };
    }>,
}));

vi.mock("@/web/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
}));

import ResetPassword from "./ResetPassword";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderResetPassword(searchParams = "?token=valid-token-123") {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[`/reset-password${searchParams}`]}>
      <ResetPassword />
    </MemoryRouter>,
  );
  return { user };
}

/**
 * Tests for the ResetPassword page which lets users set a new password
 * using a token from a password-reset email link.
 *
 * Regressions here would block users mid-recovery flow, leaving them
 * unable to regain access to their account after requesting a reset.
 */
describe("ResetPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetPassword.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Initial render with valid token
  // -----------------------------------------------------------------------

  it("renders new password and confirm password fields with a submit button", () => {
    renderResetPassword();

    expect(
      screen.getByRole("heading", { name: "Reset Password" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reset Password" }),
    ).toBeInTheDocument();
  });

  it("renders 'Back to Sign In' link pointing to /login", () => {
    renderResetPassword();

    const link = screen.getByRole("link", { name: "Back to Sign In" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/login");
  });

  // -----------------------------------------------------------------------
  // 2. Missing token renders error state
  // -----------------------------------------------------------------------

  it("shows invalid/expired link alert when token is missing", () => {
    renderResetPassword("");

    expect(
      screen.getByText(
        "Invalid or expired reset link. Please request a new one.",
      ),
    ).toBeInTheDocument();

    const link = screen.getByRole("link", {
      name: "Request new reset link",
    });
    expect(link).toHaveAttribute("href", "/forgot-password");
  });

  // -----------------------------------------------------------------------
  // 3. PasswordRequirements component
  // -----------------------------------------------------------------------

  it("shows password requirements when user starts typing in password field", async () => {
    const { user } = renderResetPassword();

    expect(
      screen.queryByLabelText("Password requirements"),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("New Password"), "a");

    await waitFor(() => {
      expect(
        screen.getByLabelText("Password requirements"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("At least 8 characters")).toBeInTheDocument();
    expect(
      screen.getByText("Contains an uppercase letter"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Contains a lowercase letter"),
    ).toBeInTheDocument();
    expect(screen.getByText("Contains a number")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 4. Validation
  // -----------------------------------------------------------------------

  it("shows validation error for empty passwords on submit", async () => {
    const { user } = renderResetPassword();

    await user.click(screen.getByRole("button", { name: "Reset Password" }));

    await waitFor(() => {
      expect(
        screen.getByText("Password must be at least 8 characters"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Please confirm your password"),
    ).toBeInTheDocument();
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it("shows password mismatch error when passwords differ", async () => {
    const { user } = renderResetPassword();

    await user.type(screen.getByLabelText("New Password"), "Password1");
    await user.type(screen.getByLabelText("Confirm Password"), "Password2");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));

    await waitFor(() => {
      expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    });

    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it("clears field error when user types in the errored field", async () => {
    const { user } = renderResetPassword();

    await user.click(screen.getByRole("button", { name: "Reset Password" }));

    await waitFor(() => {
      expect(
        screen.getByText("Password must be at least 8 characters"),
      ).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("New Password"), "a");

    await waitFor(() => {
      expect(
        screen.queryByText("Password must be at least 8 characters"),
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Successful reset
  // -----------------------------------------------------------------------

  it("calls resetPassword with token and new password, shows success", async () => {
    const { user } = renderResetPassword();

    await user.type(screen.getByLabelText("New Password"), "NewPass123");
    await user.type(screen.getByLabelText("Confirm Password"), "NewPass123");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({
        newPassword: "NewPass123",
        token: "valid-token-123",
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText("Your password has been reset successfully."),
      ).toBeInTheDocument();
    });

    const link = screen.getByRole("link", {
      name: "Sign in with your new password",
    });
    expect(link).toHaveAttribute("href", "/login");
  });

  // -----------------------------------------------------------------------
  // 6. Error handling
  // -----------------------------------------------------------------------

  it("displays server-side error from resetPassword response", async () => {
    mockResetPassword.mockResolvedValue({
      error: { message: "Token expired" },
    });
    const { user } = renderResetPassword();

    await user.type(screen.getByLabelText("New Password"), "NewPass123");
    await user.type(screen.getByLabelText("Confirm Password"), "NewPass123");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));

    await waitFor(() => {
      expect(screen.getByText("Token expired")).toBeInTheDocument();
    });
  });

  it("displays fallback error when response error has no message", async () => {
    mockResetPassword.mockResolvedValue({
      error: { message: undefined },
    });
    const { user } = renderResetPassword();

    await user.type(screen.getByLabelText("New Password"), "NewPass123");
    await user.type(screen.getByLabelText("Confirm Password"), "NewPass123");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to reset password"),
      ).toBeInTheDocument();
    });
  });

  it("displays network error when resetPassword throws", async () => {
    mockResetPassword.mockRejectedValue(new Error("Network failure"));
    const { user } = renderResetPassword();

    await user.type(screen.getByLabelText("New Password"), "NewPass123");
    await user.type(screen.getByLabelText("Confirm Password"), "NewPass123");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));

    await waitFor(() => {
      expect(
        screen.getByText("Network error. Please try again."),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Loading state
  // -----------------------------------------------------------------------

  it("disables submit button and shows loading text during submission", async () => {
    let resolveReset!: (value: { error: null }) => void;
    mockResetPassword.mockImplementation(
      () =>
        new Promise<{ error: null }>((resolve) => {
          resolveReset = resolve;
        }),
    );

    const { user } = renderResetPassword();

    await user.type(screen.getByLabelText("New Password"), "NewPass123");
    await user.type(screen.getByLabelText("Confirm Password"), "NewPass123");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Resetting..." }),
      ).toBeDisabled();
    });

    resolveReset({ error: null });

    await waitFor(() => {
      expect(
        screen.getByText("Your password has been reset successfully."),
      ).toBeInTheDocument();
    });
  });
});

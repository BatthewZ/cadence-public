import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Login from "./Login";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockSignInEmail = vi.fn();

vi.mock("@/web/lib/auth/auth-client", () => ({
  signIn: {
    email: (...args: unknown[]): Promise<{ error: null | { message?: string } }> =>
      mockSignInEmail(...args) as Promise<{ error: null | { message?: string } }>,
  },
  useSession: () => ({
    data: null,
  }),
}));

vi.mock("@/web/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function renderLogin() {
  const Wrapper = createWrapper();
  const user = userEvent.setup();
  render(
    <Wrapper>
      <Login />
    </Wrapper>
  );
  return { user };
}

/**
 * Tests for the Login page component which provides email/password
 * authentication with client-side validation via Zod, server-side error
 * display, and password visibility toggling.
 *
 * Regressions here break the primary sign-in flow, locking users out
 * of the application entirely.
 */
describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInEmail.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Initial render
  // -----------------------------------------------------------------------

  it("renders email and password fields, submit button, and Register link", () => {
    renderLogin();

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register" })).toBeInTheDocument();
  });

  it("renders the Sign In heading", () => {
    renderLogin();

    expect(screen.getByRole("heading", { name: "Sign In" })).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 2. Validation errors for empty fields
  // -----------------------------------------------------------------------

  it("shows validation errors when submitting with empty fields", async () => {
    const { user } = renderLogin();

    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid email")).toBeInTheDocument();
    });

    expect(screen.getByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(mockSignInEmail).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 3. Validation error for invalid email format
  // -----------------------------------------------------------------------

  it("shows validation error for invalid email format", async () => {
    const { user } = renderLogin();

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "validPassword123");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid email")).toBeInTheDocument();
    });

    expect(mockSignInEmail).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 4. Calls signIn with correct credentials
  // -----------------------------------------------------------------------

  it("calls signIn.email with correct credentials on valid submit", async () => {
    const { user } = renderLogin();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.type(screen.getByLabelText("Password"), "securePassword123");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(mockSignInEmail).toHaveBeenCalledWith({
        email: "alice@test.com",
        password: "securePassword123",
      });
    });
  });

  it("navigates to home after successful sign in", async () => {
    mockSignInEmail.mockResolvedValue({ error: null });
    const { user } = renderLogin();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.type(screen.getByLabelText("Password"), "securePassword123");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });

  // -----------------------------------------------------------------------
  // 5. Server-side error messages
  // -----------------------------------------------------------------------

  it("displays server-side error message from signIn response", async () => {
    mockSignInEmail.mockResolvedValue({
      error: { message: "Invalid credentials" },
    });
    const { user } = renderLogin();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.type(screen.getByLabelText("Password"), "wrongpassword1");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("displays fallback error message when signIn error has no message", async () => {
    mockSignInEmail.mockResolvedValue({
      error: { message: undefined },
    });
    const { user } = renderLogin();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.type(screen.getByLabelText("Password"), "wrongpassword1");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to sign in")).toBeInTheDocument();
    });
  });

  it("displays network error when signIn throws", async () => {
    mockSignInEmail.mockRejectedValue(new Error("Network failure"));
    const { user } = renderLogin();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.type(screen.getByLabelText("Password"), "securePassword123");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Network error. Please try again.")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Password visibility toggle
  // -----------------------------------------------------------------------

  it("toggles password visibility via the eye icon button", async () => {
    const { user } = renderLogin();

    const passwordInput = screen.getByLabelText("Password");
    expect(passwordInput).toHaveAttribute("type", "password");

    const toggleButton = screen.getByRole("button", { name: "Show password" });
    await user.click(toggleButton);

    expect(passwordInput).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  // -----------------------------------------------------------------------
  // 7. Forgot password link
  // -----------------------------------------------------------------------

  it("renders 'Forgot password?' link pointing to /forgot-password", () => {
    renderLogin();

    const link = screen.getByRole("link", { name: "Forgot password?" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/forgot-password");
  });

  it("renders Register link pointing to /register", () => {
    renderLogin();

    const link = screen.getByRole("link", { name: "Register" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/register");
  });

  // -----------------------------------------------------------------------
  // 8. Loading state during submission
  // -----------------------------------------------------------------------

  it("disables submit button and shows loading text during submission", async () => {
    // Make signIn hang so we can observe the loading state
    let resolveSignIn!: (value: { error: null }) => void;
    mockSignInEmail.mockImplementation(
      () =>
        new Promise<{ error: null }>((resolve) => {
          resolveSignIn = resolve;
        })
    );

    const { user } = renderLogin();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.type(screen.getByLabelText("Password"), "securePassword123");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Signing in..." })).toBeDisabled();
    });

    // Resolve the promise to finish the sign-in flow
    resolveSignIn({ error: null });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign In" })).toBeEnabled();
    });
  });

  // -----------------------------------------------------------------------
  // Validation error clearing
  // -----------------------------------------------------------------------

  it("clears email validation error when user types in the email field", async () => {
    const { user } = renderLogin();

    // Submit empty to trigger validation errors
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid email")).toBeInTheDocument();
    });

    // Type in email field to clear the error
    await user.type(screen.getByLabelText("Email"), "a");

    await waitFor(() => {
      expect(screen.queryByText("Invalid email")).not.toBeInTheDocument();
    });
  });

  it("clears password validation error when user types in the password field", async () => {
    const { user } = renderLogin();

    // Submit empty to trigger validation errors
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Password must be at least 8 characters")).toBeInTheDocument();
    });

    // Type in password field to clear the error
    await user.type(screen.getByLabelText("Password"), "a");

    await waitFor(() => {
      expect(screen.queryByText("Password must be at least 8 characters")).not.toBeInTheDocument();
    });
  });

  it("clears server error on next submit attempt", async () => {
    mockSignInEmail
      .mockResolvedValueOnce({ error: { message: "Invalid credentials" } })
      .mockResolvedValueOnce({ error: null });

    const { user } = renderLogin();

    await user.type(screen.getByLabelText("Email"), "alice@test.com");
    await user.type(screen.getByLabelText("Password"), "wrongpassword1");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });

    // Submit again - error should be cleared immediately and not reappear
    await user.click(screen.getByRole("button", { name: /Sign In/i }));

    await waitFor(() => {
      expect(screen.queryByText("Invalid credentials")).not.toBeInTheDocument();
    });
  });
});

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

function createWrapper(route = "/login") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[route]}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function renderLogin(route = "/login") {
  const Wrapper = createWrapper(route);
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

// ---------------------------------------------------------------------------
// Email verification + post-login destination
// ---------------------------------------------------------------------------
//
// `requireEmailVerification` is enabled server-side (it is what stops a
// stranger claiming a colleague's workspace invitation by registering their
// address), so sign-in now has a refusal mode that is not a wrong password.
// And the emailed `/invite/:token` link routes signed-out visitors through
// this page with `?redirect=`, so where the user lands afterwards is part of
// whether invitations work at all.

describe("Login — verification and redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInEmail.mockResolvedValue({ error: null });
  });

  async function submitValidCredentials(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1");
    await user.click(screen.getByRole("button", { name: "Sign In" }));
  }

  it("tells an unverified user to check their inbox rather than repeating the raw code", async () => {
    mockSignInEmail.mockResolvedValue({
      error: { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
    });

    const { user } = renderLogin();
    await submitValidCredentials(user);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/verify your email address/i);
    });
    // Better Auth re-sends the link on every refused sign-in, so the copy must
    // say so — otherwise a user whose original link expired has no reason to
    // look in their inbox again.
    expect(screen.getByRole("alert")).toHaveTextContent(/new verification link/i);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("still shows the server's message for other sign-in failures", async () => {
    mockSignInEmail.mockResolvedValue({
      error: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
    });

    const { user } = renderLogin();
    await submitValidCredentials(user);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid email or password");
    });
  });

  it("returns the user to a ?redirect= path after signing in", async () => {
    const { user } = renderLogin("/login?redirect=%2Finvite%2Fabc123");
    await submitValidCredentials(user);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/invite/abc123");
    });
  });

  it("ignores an off-site ?redirect= destination", async () => {
    // Hostile input: without the same-origin check, `?redirect=` turns this
    // page into an open redirector — a convincing phishing hop taken straight
    // after a genuine sign-in.
    const { user } = renderLogin("/login?redirect=https%3A%2F%2Fevil.example%2Fphish");
    await submitValidCredentials(user);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });

  it("ignores a scheme-relative ?redirect= destination", async () => {
    // `//evil.example` has no scheme but browsers resolve it as absolute.
    const { user } = renderLogin("/login?redirect=%2F%2Fevil.example");
    await submitValidCredentials(user);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });
});

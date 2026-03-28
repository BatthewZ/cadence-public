import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const mockSignUpEmail = vi.fn();

vi.mock("@/web/lib/auth/auth-client", () => ({
  signUp: {
    email: (...args: unknown[]): Promise<{ error: null | { message?: string } }> =>
      mockSignUpEmail(...args) as Promise<{ error: null | { message?: string } }>,
  },
}));

vi.mock("@/web/hooks/use-document-title", () => ({
  useDocumentTitle: vi.fn(),
}));

import Register from "./Register";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderRegister() {
  const user = userEvent.setup();
  const result = render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>,
  );
  return { user, ...result };
}

function getNameInput() {
  return screen.getByLabelText("Name");
}

function getEmailInput() {
  return screen.getByLabelText("Email");
}

function getPasswordInput() {
  return screen.getByLabelText("Password");
}

function getConfirmPasswordInput() {
  return screen.getByLabelText("Confirm Password");
}

function getSubmitButton() {
  return screen.getByRole("button", { name: /create account/i });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignUpEmail.mockResolvedValue({ error: null });
  });

  // 1. Renders all form fields and submit button
  it("renders name, email, password, confirm password fields and submit button", () => {
    renderRegister();

    expect(getNameInput()).toBeInTheDocument();
    expect(getEmailInput()).toBeInTheDocument();
    expect(getPasswordInput()).toBeInTheDocument();
    expect(getConfirmPasswordInput()).toBeInTheDocument();
    expect(getSubmitButton()).toBeInTheDocument();
    expect(getSubmitButton()).toHaveTextContent("Create Account");
  });

  // 2. Shows validation errors for empty required fields
  it("shows validation errors when submitting with empty fields", async () => {
    const { user } = renderRegister();

    await user.click(getSubmitButton());

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
    expect(screen.getByText("Invalid email")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(screen.getByText("Please confirm your password")).toBeInTheDocument();

    // signUp should not have been called
    expect(mockSignUpEmail).not.toHaveBeenCalled();
  });

  // 3. Shows password mismatch error when passwords don't match
  it("shows password mismatch error when passwords differ", async () => {
    const { user } = renderRegister();

    await user.type(getNameInput(), "Test User");
    await user.type(getEmailInput(), "test@example.com");
    await user.type(getPasswordInput(), "Password1");
    await user.type(getConfirmPasswordInput(), "Password2");
    await user.click(getSubmitButton());

    await waitFor(() => {
      expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    });

    expect(mockSignUpEmail).not.toHaveBeenCalled();
  });

  // 4. PasswordRequirements appears when user starts typing password
  it("shows password requirements when user types in password field", async () => {
    const { user } = renderRegister();

    // Password requirements should not be visible initially
    expect(screen.queryByLabelText("Password requirements")).not.toBeInTheDocument();

    await user.type(getPasswordInput(), "a");

    await waitFor(() => {
      expect(screen.getByLabelText("Password requirements")).toBeInTheDocument();
    });

    // Verify some requirement labels are shown
    expect(screen.getByText("At least 8 characters")).toBeInTheDocument();
    expect(screen.getByText("Contains an uppercase letter")).toBeInTheDocument();
    expect(screen.getByText("Contains a lowercase letter")).toBeInTheDocument();
    expect(screen.getByText("Contains a number")).toBeInTheDocument();
  });

  // 5. Calls signUp with correct data on valid form submit
  it("calls signUp.email with correct data on valid submission", async () => {
    const { user } = renderRegister();

    await user.type(getNameInput(), "Test User");
    await user.type(getEmailInput(), "test@example.com");
    await user.type(getPasswordInput(), "Password1");
    await user.type(getConfirmPasswordInput(), "Password1");
    await user.click(getSubmitButton());

    await waitFor(() => {
      expect(mockSignUpEmail).toHaveBeenCalledWith({
        name: "Test User",
        email: "test@example.com",
        password: "Password1",
      });
    });
  });

  // 5b. Navigates to "/" on successful registration
  it("navigates to home after successful registration", async () => {
    const { user } = renderRegister();

    await user.type(getNameInput(), "Test User");
    await user.type(getEmailInput(), "test@example.com");
    await user.type(getPasswordInput(), "Password1");
    await user.type(getConfirmPasswordInput(), "Password1");
    await user.click(getSubmitButton());

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });

  // 6. Displays server-side error messages
  it("displays server-side error message from signUp", async () => {
    mockSignUpEmail.mockResolvedValue({
      error: { message: "Email already in use" },
    });

    const { user } = renderRegister();

    await user.type(getNameInput(), "Test User");
    await user.type(getEmailInput(), "taken@example.com");
    await user.type(getPasswordInput(), "Password1");
    await user.type(getConfirmPasswordInput(), "Password1");
    await user.click(getSubmitButton());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Email already in use");
    });

    // Should not navigate on error
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // 6b. Displays fallback error message when signUp error has no message
  it("displays fallback error when signUp error message is empty", async () => {
    mockSignUpEmail.mockResolvedValue({
      error: { message: undefined },
    });

    const { user } = renderRegister();

    await user.type(getNameInput(), "Test User");
    await user.type(getEmailInput(), "test@example.com");
    await user.type(getPasswordInput(), "Password1");
    await user.type(getConfirmPasswordInput(), "Password1");
    await user.click(getSubmitButton());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to register");
    });
  });

  // 6c. Displays network error when signUp throws
  it("displays network error when signUp rejects", async () => {
    mockSignUpEmail.mockRejectedValue(new Error("Network failure"));

    const { user } = renderRegister();

    await user.type(getNameInput(), "Test User");
    await user.type(getEmailInput(), "test@example.com");
    await user.type(getPasswordInput(), "Password1");
    await user.type(getConfirmPasswordInput(), "Password1");
    await user.click(getSubmitButton());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Network error. Please try again.");
    });
  });

  // 7. "Sign in" link navigates to login page
  it("has a sign in link that points to /login", () => {
    renderRegister();

    const signInLink = screen.getByRole("link", { name: /sign in/i });
    expect(signInLink).toBeInTheDocument();
    expect(signInLink).toHaveAttribute("href", "/login");
  });

  // 8. Disables submit button during submission
  it("disables submit button and shows loading text during submission", async () => {
    // Make signUp hang so we can observe the loading state
    let resolveSignUp!: (value: { error: null }) => void;
    mockSignUpEmail.mockImplementation(
      () => new Promise<{ error: null }>((resolve) => { resolveSignUp = resolve; }),
    );

    const { user } = renderRegister();

    await user.type(getNameInput(), "Test User");
    await user.type(getEmailInput(), "test@example.com");
    await user.type(getPasswordInput(), "Password1");
    await user.type(getConfirmPasswordInput(), "Password1");
    await user.click(getSubmitButton());

    // While loading, button should be disabled and show loading text
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /creating account/i })).toBeDisabled();
    });

    // Resolve the promise
    resolveSignUp({ error: null });

    // After resolution, button should revert
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create account/i })).not.toBeDisabled();
    });
  });

  // 9. Clearing field errors on input change
  it("clears field error when user types in the errored field", async () => {
    const { user } = renderRegister();

    // Submit empty form to trigger validation errors
    await user.click(getSubmitButton());

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });

    // Start typing in the name field
    await user.type(getNameInput(), "A");

    await waitFor(() => {
      expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
    });
  });
});

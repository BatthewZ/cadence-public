import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", () => ({
  Navigate: (props: { to: string; replace?: boolean }) => {
    mockNavigate(props);
    return null;
  },
}));

const mockUseSession = vi.fn();

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: (): unknown => mockUseSession(),
}));

import { GuestGuard } from "./GuestGuard";

describe("GuestGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children when user is not authenticated", () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
    });

    render(<GuestGuard><span>Guest Content</span></GuestGuard>);
    expect(screen.getByText("Guest Content")).toBeInTheDocument();
  });

  it("redirects to home when user is authenticated", () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "1" } },
      isPending: false,
    });

    render(<GuestGuard><span>Guest Content</span></GuestGuard>);
    expect(screen.queryByText("Guest Content")).not.toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/", replace: true })
    );
  });

  it("shows loading state while auth is pending on first load", () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: true,
    });

    const { container } = render(<GuestGuard><span>Guest Content</span></GuestGuard>);
    expect(screen.queryByText("Guest Content")).not.toBeInTheDocument();
    // Should render Spinner inside Center
    expect(container.querySelector("[role='status']")).toBeTruthy();
  });

  it("keeps the guest page mounted across a later session refetch", () => {
    // Regression guard. `isPending` goes true again on every background
    // session refetch, and `signUp.email()` triggers one. Swapping the page
    // for a spinner at that moment unmounts it, destroying its React state:
    // the Register page's "check your email for a verification link"
    // confirmation vanished the instant it was set, leaving a blank form and
    // no sign the account had been created.
    //
    // The assertion is DOM-node identity, not presence: a remount would still
    // render "Guest Content", so a text check alone would pass while the bug
    // was live. Same node ⇒ React reused the subtree ⇒ its state survived.
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    const { rerender, container } = render(
      <GuestGuard><span>Guest Content</span></GuestGuard>,
    );
    const firstNode = screen.getByText("Guest Content");

    // …now a refetch starts.
    mockUseSession.mockReturnValue({ data: null, isPending: true });
    rerender(<GuestGuard><span>Guest Content</span></GuestGuard>);

    expect(container.querySelector("[role='status']")).toBeNull();
    expect(screen.getByText("Guest Content")).toBe(firstNode);
  });

  it("still redirects if a session appears during a refetch", () => {
    // Tolerating the refetch must not tolerate an authenticated user sitting
    // on a guest page: the moment a session resolves, the redirect fires.
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    const { rerender } = render(<GuestGuard><span>Guest Content</span></GuestGuard>);

    mockUseSession.mockReturnValue({ data: { user: { id: "1" } }, isPending: true });
    rerender(<GuestGuard><span>Guest Content</span></GuestGuard>);

    expect(screen.queryByText("Guest Content")).not.toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/", replace: true })
    );
  });
});

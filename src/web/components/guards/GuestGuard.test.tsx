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

  it("shows loading state while auth is pending", () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: true,
    });

    const { container } = render(<GuestGuard><span>Guest Content</span></GuestGuard>);
    expect(screen.queryByText("Guest Content")).not.toBeInTheDocument();
    // Should render Spinner inside Center
    expect(container.querySelector("[role='status']")).toBeTruthy();
  });
});

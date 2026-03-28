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

import { AuthGuard } from "./AuthGuard";

describe("AuthGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children when user is authenticated", () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "1" } },
      isPending: false,
    });

    render(<AuthGuard><span>Protected</span></AuthGuard>);
    expect(screen.getByText("Protected")).toBeInTheDocument();
  });

  it("redirects to login when user is not authenticated", () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
    });

    render(<AuthGuard><span>Protected</span></AuthGuard>);
    expect(screen.queryByText("Protected")).not.toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/login", replace: true })
    );
  });

  it("shows loading state while auth is pending", () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: true,
    });

    const { container } = render(<AuthGuard><span>Protected</span></AuthGuard>);
    expect(screen.queryByText("Protected")).not.toBeInTheDocument();
    // Should render Spinner inside Center
    expect(container.querySelector("[role='status']")).toBeTruthy();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
}));

const mockUseSession = vi.fn();
const mockSignOut = vi.fn();

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: (): unknown => mockUseSession(),
  signOut: (...args: unknown[]): unknown => mockSignOut(...args),
}));

vi.mock("@/web/components/layout/NotificationBell", () => ({
  NotificationBell: () => <div data-testid="notification-bell">NotificationBell</div>,
}));

vi.mock("@/web/contexts/WorkspaceContext", () => ({
  useOptionalWorkspace: () => null,
}));

vi.mock("@/web/components/ui/AppShell", () => {
  const AppShell = ({ children, ...props }: Record<string, unknown>) => (
    <div data-testid="app-shell" {...props}>
      {children as React.ReactNode}
    </div>
  );
  AppShell.Navbar = ({ children }: { children: React.ReactNode }) => (
    <nav>{children}</nav>
  );
  AppShell.Toggle = () => <button>Toggle</button>;
  AppShell.Brand = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  AppShell.NavbarActions = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  AppShell.Sidebar = ({ children }: { children: React.ReactNode }) => (
    <aside>{children}</aside>
  );
  AppShell.SidebarSection = ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title?: string;
  }) => (
    <div>
      {title && <div>{title}</div>}
      {children}
    </div>
  );
  AppShell.SidebarLink = ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
  }) => <a href={to}>{children}</a>;
  AppShell.Main = ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  );
  const useAppShell = () => ({ isMobile: false, sidebarOpen: true, setSidebarOpen: vi.fn() });
  const useOptionalAppShell = () => ({ isMobile: false, sidebarOpen: true, setSidebarOpen: vi.fn() });
  return { AppShell, useAppShell, useOptionalAppShell };
});

import { AuthenticatedLayout } from "./AuthenticatedLayout";

describe("AuthenticatedLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      data: { user: { name: "Test User", email: "test@example.com" } },
    });
    mockSignOut.mockResolvedValue(undefined);
  });

  it("renders the app name", () => {
    render(<AuthenticatedLayout>Content</AuthenticatedLayout>);
    expect(screen.getByText("App Name")).toBeInTheDocument();
  });

  it("renders Dashboard navigation link", () => {
    render(<AuthenticatedLayout>Content</AuthenticatedLayout>);
    const dashboardLink = screen.getByText("Dashboard");

    expect(dashboardLink).toBeInTheDocument();
    expect(dashboardLink.closest("a")).toHaveAttribute("href", "/");
  });

  it("renders user name and email from session", () => {
    render(<AuthenticatedLayout>Content</AuthenticatedLayout>);
    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
  });

  it("does not render user info when session has no user", () => {
    mockUseSession.mockReturnValue({ data: null });
    render(<AuthenticatedLayout>Content</AuthenticatedLayout>);
    expect(screen.queryByText("Test User")).not.toBeInTheDocument();
    expect(screen.queryByText("test@example.com")).not.toBeInTheDocument();
  });

  it("renders Sign Out in the user menu dropdown", async () => {
    const user = userEvent.setup();
    render(<AuthenticatedLayout>Content</AuthenticatedLayout>);

    // Open the user menu dropdown
    const accountMenuButton = screen.getByLabelText("Account menu");
    await user.click(accountMenuButton);

    expect(screen.getByText("Sign Out")).toBeInTheDocument();
  });

  it("calls signOut when Sign Out is clicked", async () => {
    const user = userEvent.setup();
    render(<AuthenticatedLayout>Content</AuthenticatedLayout>);

    // Open the user menu dropdown and click Sign Out
    const accountMenuButton = screen.getByLabelText("Account menu");
    await user.click(accountMenuButton);
    await user.click(screen.getByText("Sign Out"));

    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  it("navigates to /login after successful sign out", async () => {
    const user = userEvent.setup();
    render(<AuthenticatedLayout>Content</AuthenticatedLayout>);

    // Open the user menu dropdown and click Sign Out
    const accountMenuButton = screen.getByLabelText("Account menu");
    await user.click(accountMenuButton);
    await user.click(screen.getByText("Sign Out"));

    // Wait for async sign-out to complete
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/login");
    });
  });

  it("renders children content", () => {
    render(
      <AuthenticatedLayout>
        <div>Page Content</div>
      </AuthenticatedLayout>,
    );
    expect(screen.getByText("Page Content")).toBeInTheDocument();
  });

  it("renders children inside main element", () => {
    render(
      <AuthenticatedLayout>
        <div data-testid="child">Child</div>
      </AuthenticatedLayout>,
    );
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByTestId("child"));
  });
});

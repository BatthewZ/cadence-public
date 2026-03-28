import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";

function renderWithRouter(ui: React.ReactElement, { route = "/" } = {}) {
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    ),
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppShell", () => {
  it("renders navbar with role='banner'", () => {
    renderWithRouter(
      <AppShell>
        <AppShell.Navbar>Nav content</AppShell.Navbar>
        <AppShell.Main>Main</AppShell.Main>
      </AppShell>,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByText("Nav content")).toBeInTheDocument();
  });

  it("renders sidebar with role='navigation'", () => {
    renderWithRouter(
      <AppShell>
        <AppShell.Sidebar>Sidebar content</AppShell.Sidebar>
        <AppShell.Main>Main</AppShell.Main>
      </AppShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByText("Sidebar content")).toBeInTheDocument();
  });

  it("renders main content area", () => {
    renderWithRouter(
      <AppShell>
        <AppShell.Main>Main content here</AppShell.Main>
      </AppShell>,
    );
    expect(screen.getByText("Main content here")).toBeInTheDocument();
  });

  it("renders sidebar sections with titles", () => {
    renderWithRouter(
      <AppShell>
        <AppShell.Sidebar>
          <AppShell.SidebarSection title="Section A">
            <div>Link A</div>
          </AppShell.SidebarSection>
          <AppShell.SidebarSection title="Section B">
            <div>Link B</div>
          </AppShell.SidebarSection>
        </AppShell.Sidebar>
        <AppShell.Main>Main</AppShell.Main>
      </AppShell>,
    );
    expect(screen.getByText("Section A")).toBeInTheDocument();
    expect(screen.getByText("Section B")).toBeInTheDocument();
  });

  it("renders sidebar links", () => {
    renderWithRouter(
      <AppShell>
        <AppShell.Sidebar>
          <AppShell.SidebarLink to="/dashboard">Dashboard</AppShell.SidebarLink>
          <AppShell.SidebarLink to="/settings">Settings</AppShell.SidebarLink>
        </AppShell.Sidebar>
        <AppShell.Main>Main</AppShell.Main>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("marks the active sidebar link with aria-current='page'", () => {
    renderWithRouter(
      <AppShell>
        <AppShell.Sidebar>
          <AppShell.SidebarLink to="/">Home</AppShell.SidebarLink>
          <AppShell.SidebarLink to="/about">About</AppShell.SidebarLink>
        </AppShell.Sidebar>
        <AppShell.Main>Main</AppShell.Main>
      </AppShell>,
      { route: "/" },
    );
    const homeLink = screen.getByRole("link", { name: "Home" });
    expect(homeLink).toHaveAttribute("aria-current", "page");

    const aboutLink = screen.getByRole("link", { name: "About" });
    expect(aboutLink).not.toHaveAttribute("aria-current");
  });

  it("toggle has aria-expanded true by default (sidebar not collapsed)", () => {
    renderWithRouter(
      <AppShell>
        <AppShell.Navbar>
          <AppShell.Toggle />
        </AppShell.Navbar>
        <AppShell.Sidebar>Sidebar</AppShell.Sidebar>
        <AppShell.Main>Main</AppShell.Main>
      </AppShell>,
    );
    const toggle = screen.getByRole("button", { name: /sidebar/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("clicking toggle collapses sidebar (aria-expanded toggles)", async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <AppShell>
        <AppShell.Navbar>
          <AppShell.Toggle />
        </AppShell.Navbar>
        <AppShell.Sidebar>Sidebar</AppShell.Sidebar>
        <AppShell.Main>Main</AppShell.Main>
      </AppShell>,
    );
    const toggle = screen.getByRole("button", { name: /sidebar/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("toggle controls aria-expanded of the sidebar via aria-controls", () => {
    renderWithRouter(
      <AppShell>
        <AppShell.Navbar>
          <AppShell.Toggle />
        </AppShell.Navbar>
        <AppShell.Sidebar>Sidebar</AppShell.Sidebar>
        <AppShell.Main>Main</AppShell.Main>
      </AppShell>,
    );
    const toggle = screen.getByRole("button", { name: /sidebar/i });
    const sidebarId = toggle.getAttribute("aria-controls");
    expect(sidebarId).toBeTruthy();

    const sidebar = screen.getByRole("navigation", { name: "Main navigation" });
    expect(sidebar.id).toBe(sidebarId);
  });

  it("sidebar gets data-collapsed attribute when collapsed", async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <AppShell>
        <AppShell.Navbar>
          <AppShell.Toggle />
        </AppShell.Navbar>
        <AppShell.Sidebar>Sidebar</AppShell.Sidebar>
        <AppShell.Main>Main</AppShell.Main>
      </AppShell>,
    );
    const sidebar = screen.getByRole("navigation", { name: "Main navigation" });
    expect(sidebar).not.toHaveAttribute("data-collapsed");

    const toggle = screen.getByRole("button", { name: /sidebar/i });
    await user.click(toggle);
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
  });

  it("renders brand slot in the navbar", () => {
    renderWithRouter(
      <AppShell>
        <AppShell.Navbar>
          <AppShell.Brand>MyApp</AppShell.Brand>
        </AppShell.Navbar>
        <AppShell.Main>Main</AppShell.Main>
      </AppShell>,
    );
    expect(screen.getByText("MyApp")).toBeInTheDocument();
  });

  it("renders navbar actions slot", () => {
    renderWithRouter(
      <AppShell>
        <AppShell.Navbar>
          <AppShell.NavbarActions>
            <button type="button">Profile</button>
          </AppShell.NavbarActions>
        </AppShell.Navbar>
        <AppShell.Main>Main</AppShell.Main>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Profile" })).toBeInTheDocument();
  });
});

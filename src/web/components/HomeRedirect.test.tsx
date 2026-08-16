import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type SessionState = { data: { user: { id: string } } | null; isPending: boolean };

const mockSession: { value: SessionState } = {
  value: { data: null, isPending: true },
};

vi.mock("@/web/lib/auth/auth-client", () => ({
  useSession: () => mockSession.value,
}));

vi.mock("@/web/pages/Landing/Landing", () => ({
  default: () => <div data-testid="landing">Landing page</div>,
}));

import { HomeRedirect } from "./HomeRedirect";

/**
 * One stable element type at the root so `rerender` reconciles rather than
 * remounts. That matters more than usual here: the behaviour under test is
 * precisely that a session refetch does NOT remount the subtree, and a harness
 * that swapped the tree would destroy the thing it was meant to observe.
 */
function App() {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/workspaces" element={<div data-testid="workspaces" />} />
        <Route path="/w/:slug/dashboard" element={<div data-testid="dashboard" />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderHome() {
  return render(<App />);
}

/**
 * `HomeRedirect` renders the public landing page inline for logged-out
 * visitors, which is why it reads the session through `useGuestSession` rather
 * than `useSession` directly.
 *
 * Better Auth re-arms `isPending` on every background refetch while the session
 * is null — window focus, tab visibility, storage events, coming back online.
 * Keying a full-screen spinner off that value swapped the landing page out and
 * back on a plain tab-switch, remounting it: scroll position lost, open mobile
 * nav closed. These tests pin the two halves of the contract — the loader
 * appears only before the session is first known, and a session still wins the
 * moment one exists.
 */
describe("HomeRedirect", () => {
  beforeEach(() => {
    localStorage.clear();
    mockSession.value = { data: null, isPending: true };
  });

  it("shows the loader only until the session first resolves", async () => {
    const { rerender } = renderHome();

    expect(screen.queryByTestId("landing")).toBeNull();

    mockSession.value = { data: null, isPending: false };
    rerender(<App />);

    expect(await screen.findByTestId("landing")).toBeInTheDocument();
  });

  it("keeps the landing page mounted across a background session refetch", async () => {
    mockSession.value = { data: null, isPending: false };
    const { rerender } = renderHome();

    const landing = await screen.findByTestId("landing");

    // A refetch fires: `isPending` goes true again with the session still null.
    mockSession.value = { data: null, isPending: true };
    rerender(<App />);

    // Same node, not a remount — a replaced element would have lost the scroll
    // position and any open mobile nav inside it.
    expect(screen.getByTestId("landing")).toBe(landing);
  });

  it("sends a signed-in visitor to their last workspace", async () => {
    localStorage.setItem("lastWorkspaceSlug", "acme");
    mockSession.value = { data: { user: { id: "user-1" } }, isPending: false };

    renderHome();

    await waitFor(() => {
      expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    });
  });

  it("sends a signed-in visitor with no remembered workspace to the picker", async () => {
    mockSession.value = { data: { user: { id: "user-1" } }, isPending: false };

    renderHome();

    await waitFor(() => {
      expect(screen.getByTestId("workspaces")).toBeInTheDocument();
    });
  });

  it("redirects as soon as a session appears mid-refetch", async () => {
    // The only session outcome this surface has to act on. Not showing a
    // spinner during refetches must not mean missing the transition.
    mockSession.value = { data: null, isPending: false };
    const { rerender } = renderHome();
    await screen.findByTestId("landing");

    mockSession.value = { data: { user: { id: "user-1" } }, isPending: true };
    rerender(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("workspaces")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("landing")).toBeNull();
  });
});

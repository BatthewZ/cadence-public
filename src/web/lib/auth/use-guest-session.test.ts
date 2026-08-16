import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseSession = vi.fn();

vi.mock("./auth-client", () => ({
  useSession: (): unknown => mockUseSession(),
}));

import { useGuestSession } from "./use-guest-session";

/**
 * The single source of truth for "is this guest surface safe to render yet".
 *
 * Both `GuestGuard` and `HomeRedirect` used to key their full-screen spinner
 * off `useSession().isPending` directly. Better Auth re-arms that flag on every
 * background refetch while the session is null — window focus, tab visibility,
 * coming back online, and any session-mutating call — so the spinner replaced
 * the page mid-session and React discarded the subtree's state. The visible
 * symptom was the registration confirmation ("check your email for a
 * verification link") vanishing the instant it was set.
 */
describe("useGuestSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for the loader while the session is unknown on first load", () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true });

    const { result } = renderHook(() => useGuestSession());

    expect(result.current.showInitialLoader).toBe(true);
    expect(result.current.session).toBeNull();
  });

  it("does not ask for the loader again once the session has resolved", () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    const { result, rerender } = renderHook(() => useGuestSession());
    expect(result.current.showInitialLoader).toBe(false);

    // A background refetch begins: `isPending` goes true again.
    mockUseSession.mockReturnValue({ data: null, isPending: true });
    rerender();

    expect(result.current.showInitialLoader).toBe(false);
  });

  it("reports a session that appears during a refetch", () => {
    // Tolerating the refetch must not hide a newly authenticated user from the
    // caller — that is what drives the redirect off the guest surface.
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    const { result, rerender } = renderHook(() => useGuestSession());

    mockUseSession.mockReturnValue({ data: { user: { id: "1" } }, isPending: true });
    rerender();

    expect(result.current.session).toEqual({ user: { id: "1" } });
    expect(result.current.showInitialLoader).toBe(false);
  });

  it("tracks resolution per mount, not globally", () => {
    // A fresh mount genuinely does not know the session yet, even if some
    // earlier mount did. Hoisting the flag to module scope would skip the
    // loader on a cold navigation and flash the wrong page.
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    renderHook(() => useGuestSession());

    mockUseSession.mockReturnValue({ data: null, isPending: true });
    const { result } = renderHook(() => useGuestSession());

    expect(result.current.showInitialLoader).toBe(true);
  });
});

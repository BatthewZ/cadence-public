import { useState } from "react";

import { useSession } from "./auth-client";

/**
 * Session state for a surface rendered to *logged-out* visitors — the guest
 * routes and the landing page.
 *
 * The problem it solves: Better Auth re-arms `useSession().isPending` on every
 * background refetch whenever the current session data is `null`, and refetches
 * fire on window focus, tab visibility, storage events, coming back online,
 * and any session-mutating call. A component that returns a spinner whenever
 * `isPending` is true therefore swaps its whole subtree out mid-session, and
 * React discards the state inside it.
 *
 * That is not hypothetical: registering calls `signUp.email`, which triggers a
 * refetch; `GuestGuard` flashed its spinner and remounted `Register`, wiping
 * the "check your email for a verification link" confirmation the page had
 * just set and leaving the user on a blank form with no sign their account
 * existed. The same hazard covers `ForgotPassword` and `ResetPassword`, which
 * also end on a post-submit view, and the landing page, which loses scroll
 * position and any open mobile nav on a simple tab-switch.
 *
 * `showInitialLoader` is therefore true only while the session is genuinely
 * unknown — the first resolve of this mount. After that a refetch changes
 * nothing about whether a guest surface is safe to render: the only outcome
 * that matters is a session appearing, and callers handle that by acting on
 * `session` on the very next render.
 *
 * Deliberately NOT used by `AuthGuard`. There the fail-closed behaviour is
 * correct — an unknown session on a protected page must show nothing rather
 * than render protected UI and redirect a beat later.
 */
export function useGuestSession() {
  const { data: session, isPending } = useSession();

  // State, adjusted during render — React's documented pattern for a value
  // derived from something that changed since the last render
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  // A ref would be wrong: this value decides what gets rendered, and React
  // forbids reading or writing refs mid-render precisely because that would
  // not schedule the re-render such a decision needs. An effect would be
  // wrong too — it fires after paint, so the flag could lag a commit behind.
  const [hasResolvedOnce, setHasResolvedOnce] = useState(false);
  if (!isPending && !hasResolvedOnce) {
    setHasResolvedOnce(true);
  }

  return {
    session,
    showInitialLoader: isPending && !hasResolvedOnce,
  };
}

import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";

import { clearCachedSession, readCachedSession, writeCachedSession } from "./session-cache";

const authClient = createAuthClient({
  baseURL: window.location.origin,
});

type AuthSession = typeof authClient.$Infer.Session;
type SessionResult = ReturnType<typeof authClient.useSession>;

/** A server that hasn't answered within this long is treated like no connection (lie-fi). */
export const SESSION_FALLBACK_MS = 3_000;

function errorStatus(error: NonNullable<SessionResult["error"]>): number | undefined {
  return (error as { status?: number }).status;
}

function isConnectionFailure(error: SessionResult["error"]): boolean {
  if (!error) return false;
  const status = errorStatus(error);
  return status === undefined || status === 0 || status >= 500;
}

/**
 * Better Auth's `useSession`, plus offline boot: when the server can't be reached (no
 * connection, a failed request, or no answer within SESSION_FALLBACK_MS) the last confirmed
 * session is used. A definite answer from the server — a session, none, or 401 — always wins
 * and updates the cache.
 */
export function useSession(): SessionResult {
  const result = authClient.useSession();
  const { data, error, isPending } = result;
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(isPending), isPending ? SESSION_FALLBACK_MS : 0);
    return () => clearTimeout(timer);
  }, [isPending]);

  useEffect(() => {
    if (data) writeCachedSession(data);
    else if (!isPending && (!error || errorStatus(error) === 401)) clearCachedSession();
  }, [data, error, isPending]);

  if (data) return result;
  const unreachable =
    isConnectionFailure(error) ||
    (isPending && (slow || (typeof navigator !== "undefined" && !navigator.onLine)));
  if (!unreachable) return result;
  const cached = readCachedSession<AuthSession>();
  if (!cached) return result;
  return { ...result, data: cached, error: null, isPending: false };
}

export const {
  signIn,
  signUp,
  signOut,
  updateUser,
  changePassword,
  deleteUser,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  requestPasswordReset,
  resetPassword,
} = authClient;

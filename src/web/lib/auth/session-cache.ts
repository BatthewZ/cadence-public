/**
 * The last session the server confirmed, so the app can boot and show this device's saved data
 * while offline. Identity only: the cookie still authenticates every request, and the server
 * authorizes every replayed write. The session token is never stored (the cookie is httpOnly).
 */

const KEY = "cadence:session";

export interface CachedSessionData<S> {
  data: S;
  /** Epoch ms the cached session stops being trusted (the server session's own expiry). */
  expiresAt: number;
}

interface SessionShape {
  user: { id: string };
  session: { expiresAt: Date | string; token?: string };
}

export function readCachedSession<S extends SessionShape>(now = Date.now()): S | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedSessionData<S>;
    return cached.expiresAt > now ? cached.data : null;
  } catch {
    return null;
  }
}

export function writeCachedSession<S extends SessionShape>(data: S): void {
  const expiresAt = new Date(data.session.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return;
  const stored: CachedSessionData<S> = {
    data: { ...data, session: { ...data.session, token: "" } },
    expiresAt,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Safari private mode and full storage throw; offline boot just isn't available then.
  }
}

export function clearCachedSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // As above.
  }
}

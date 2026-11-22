import type { OfflineError } from "@/web/lib/api/client";
import { useOnline } from "@/web/lib/offline/hooks";

export const NEEDS_CONNECTION_HINT = "Needs a connection";

export interface OnlineOnly {
  online: boolean;
  /** Spread onto the control that starts an online-only action. */
  disabled: boolean;
  /** The hover explanation while `disabled`; undefined online so no tooltip repeats the label. */
  title: string | undefined;
}

/** State for a control whose action can't be queued offline (uploads, invites, tokens, exports…). */
export function useOnlineOnly(hint: string = NEEDS_CONNECTION_HINT): OnlineOnly {
  const online = useOnline();
  return { online, disabled: !online, title: online ? undefined : hint };
}

function isOfflineError(error: unknown): error is OfflineError {
  return error instanceof Error && error.name === "OfflineError";
}

/**
 * True when a query has nothing to show because the server can't be reached: paused by
 * TanStack while offline, or failed with no connection while the browser still claimed one.
 */
export function isUnavailableOffline(query: {
  data: unknown;
  fetchStatus: string;
  error: unknown;
}): boolean {
  return (
    query.data === undefined &&
    (query.fetchStatus === "paused" || isOfflineError(query.error))
  );
}

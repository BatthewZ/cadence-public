import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { STORAGE_KEY } from "@/web/hooks/use-theme";
import { signOut, useSession } from "@/web/lib/auth/auth-client";
import { clearCachedSession } from "@/web/lib/auth/session-cache";
import { pendingWriteCount, wipeOfflineData } from "@/web/lib/offline/runtime";

import { useOnlineOnly } from "./use-online-only";

export const SIGN_OUT_NEEDS_CONNECTION = "Sign out needs a connection";

/**
 * Deletes what this device holds for the account — saved reads, unsent writes, the cached
 * session and the in-memory cache. Only after the server has ended the session: a failed
 * sign-out must leave everything in place.
 */
export async function forgetThisDevice(userId: string, queryClient: QueryClient): Promise<void> {
  try {
    await wipeOfflineData(userId);
  } catch (err) {
    console.error("[offline] couldn't delete this device's saved data", err);
  }
  clearCachedSession();
  queryClient.clear();
}

export interface SignOutFlow {
  /** Starts sign-out, first asking to confirm when unsynced changes would be deleted. */
  request: () => void;
  /** Unsynced changes the open confirmation is about; 0 when it is closed. */
  unsynced: number;
  confirm: () => void;
  cancel: () => void;
  signingOut: boolean;
  disabled: boolean;
  title: string | undefined;
}

export function useSignOut(onSignedOut: () => void): SignOutFlow {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user.id;
  const { online, title } = useOnlineOnly(SIGN_OUT_NEEDS_CONNECTION);
  const [unsynced, setUnsynced] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  const signOutNow = useCallback(async () => {
    setUnsynced(0);
    setSigningOut(true);
    try {
      const { error } = await signOut();
      if (error) {
        setSigningOut(false);
        return;
      }
    } catch {
      setSigningOut(false);
      return;
    }
    if (userId) await forgetThisDevice(userId, queryClient);
    else queryClient.clear();
    document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private browsing.
    }
    onSignedOut();
  }, [onSignedOut, queryClient, userId]);

  const request = useCallback(() => {
    if (!online) return;
    const count = pendingWriteCount();
    if (count > 0) setUnsynced(count);
    else void signOutNow();
  }, [online, signOutNow]);

  return {
    request,
    unsynced,
    confirm: () => void signOutNow(),
    cancel: () => setUnsynced(0),
    signingOut,
    disabled: !online || signingOut,
    title,
  };
}

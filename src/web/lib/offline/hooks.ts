import { onlineManager } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { Outbox, Refusal, SyncStatus } from "./outbox";
import type { QueuedWrite } from "./perform-write";
import { activeOutbox, subscribeRuntime } from "./runtime";

const subscribeOnline = (listener: () => void) => onlineManager.subscribe(listener);
const getOnline = () => onlineManager.isOnline();

/** Whether the browser reports a connection. Online-only controls disable themselves on false. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnline, getOnline);
}

const OFF: SyncStatus = {
  online: true,
  pending: 0,
  sending: 0,
  state: "idle",
  blockedReason: null,
  nextRetryAt: null,
  lastError: null,
};

/** Keeps `attach` subscribed to whichever outbox is active, re-attaching each time the runtime changes. */
function followActiveOutbox(
  attach: (outbox: Outbox) => () => void,
  onRuntimeChange?: () => void
): () => void {
  const attachActive = () => {
    const outbox = activeOutbox();
    return outbox ? attach(outbox) : undefined;
  };
  let detach = attachActive();
  const unsubscribeRuntime = subscribeRuntime(() => {
    detach?.();
    detach = attachActive();
    onRuntimeChange?.();
  });
  return () => {
    detach?.();
    unsubscribeRuntime();
  };
}

function subscribeStatus(listener: () => void): () => void {
  return followActiveOutbox((outbox) => outbox.subscribe(listener), listener);
}

const getStatus = () => activeOutbox()?.getStatus() ?? OFF;

/** The write queue's state for the sync badge; a quiet idle state when offline mode is off. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus);
}

/** The queued writes, oldest first, re-read whenever the queue changes. */
export function useQueuedWrites(): QueuedWrite[] {
  const status = useSyncStatus();
  const [writes, setWrites] = useState<QueuedWrite[]>([]);
  const outbox = activeOutbox();
  useEffect(() => {
    if (!outbox) return;
    let cancelled = false;
    void outbox.list().then((rows) => {
      if (!cancelled) setWrites(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [outbox, status.pending, status.state, status.lastError]);
  return outbox ? writes : [];
}

export function useSyncActions(): { retry: () => void; discard: (id: number) => void } {
  const retry = useCallback(() => void activeOutbox()?.retry(), []);
  const discard = useCallback((id: number) => void activeOutbox()?.discard(id), []);
  return { retry, discard };
}

/** Calls `onRefusal` for each queued write the server refuses while this component is mounted. */
export function useSyncRefusals(onRefusal: (refusal: Refusal) => void): void {
  useEffect(() => followActiveOutbox((outbox) => outbox.subscribeRefusals(onRefusal)), [onRefusal]);
}

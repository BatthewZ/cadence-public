import {
  AlertTriangle,
  CloudOff,
  type LucideIcon,
  RefreshCw,
  TimerReset,
  UploadCloud,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/web/components/ui/Button";
import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";
import { Popover } from "@/web/components/ui/Popover";
import { Text } from "@/web/components/ui/Text";
import { useOnline, useQueuedWrites, useSyncActions, useSyncStatus } from "@/web/lib/offline/hooks";
import { queuedCount, type SyncStatus } from "@/web/lib/offline/outbox";
import type { QueuedWrite } from "@/web/lib/offline/perform-write";
import { formatRelativeFuture, formatRelativeTime } from "@/web/util/activity";
import { cn } from "@/web/util/style/style";

type Tone = "neutral" | "info" | "warning" | "error";

interface BadgeView {
  label: string;
  icon: LucideIcon;
  tone: Tone;
  spin?: boolean;
  heading: string;
  description: string;
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-secondary border-border-default",
  info: "bg-status-info-bg text-status-info border-status-info/20",
  warning: "bg-status-warning-bg text-status-warning border-status-warning/20",
  error: "bg-status-error-bg text-status-error border-status-error/20",
};

/** What the badge says for a sync state; null when there is nothing to say. Offline outranks every queue state. */
function describeSync(status: SyncStatus, online: boolean): BadgeView | null {
  // Writes made online and still being sent aren't "to sync": showing them would flash the badge on every edit.
  const n = queuedCount(status);
  if (!online) {
    return {
      label: n > 0 ? `Offline · ${n} to sync` : "Offline",
      icon: CloudOff,
      tone: "neutral",
      heading: "You're offline",
      description:
        n > 0
          ? "These changes are saved on this device and will sync when you're back online."
          : "Changes you make are saved on this device and sync when you're back online.",
    };
  }
  switch (status.state) {
    case "blocked":
      return status.blockedReason === "auth"
        ? {
            label: "Sign in to sync",
            icon: AlertTriangle,
            tone: "error",
            heading: "Sign in to sync",
            description:
              "Your session ended before these changes were sent. Sign in again to send them.",
          }
        : {
            label: "Can't sync",
            icon: AlertTriangle,
            tone: "error",
            heading: "Can't sync",
            description:
              "A change keeps failing on the server, so the ones after it are waiting. Retry it, or discard it.",
          };
    case "waiting":
      if (n === 0) return null;
      return {
        label: `Retrying soon · ${n}`,
        icon: TimerReset,
        tone: "warning",
        heading: "Retrying soon",
        description: status.nextRetryAt
          ? `Couldn't reach the server. Trying again ${formatRelativeFuture(status.nextRetryAt)}.`
          : "Couldn't reach the server. Trying again shortly.",
      };
    case "syncing":
      if (n === 0) return null;
      return {
        label: `Syncing ${n}…`,
        icon: RefreshCw,
        tone: "info",
        spin: true,
        heading: "Syncing",
        description: "Sending the changes you made offline.",
      };
    case "idle":
      if (n === 0) return null;
      return {
        label: `${n} to sync`,
        icon: UploadCloud,
        tone: "neutral",
        heading: "Waiting to sync",
        description: "These changes are saved on this device and haven't been sent yet.",
      };
  }
}

/** Navbar indicator for the offline write queue; opens a list of the unsent changes. */
export function SyncStatusBadge() {
  const status = useSyncStatus();
  const online = useOnline();
  const writes = useQueuedWrites();
  const { retry, discard } = useSyncActions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [discarding, setDiscarding] = useState<QueuedWrite | null>(null);

  const view = describeSync(status, online);
  if (!view) return null;
  const Icon = view.icon;
  const signInNeeded = online && status.state === "blocked" && status.blockedReason === "auth";
  const queued = queuedCount(status);

  return (
    <>
      <span role="status" aria-label="Sync status" className="inline-flex">
        <Popover open={open} onOpenChange={setOpen} placement="bottom-end" offset={4}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-9 items-center gap-r6 rounded-md border px-r5 text-body-3 font-semibold whitespace-nowrap cursor-pointer",
                "ring-2 ring-transparent focus-visible:ring-border-focus focus-visible:ring-offset-2",
                TONE_CLASS[view.tone]
              )}
            >
              <Icon
                size={16}
                aria-hidden
                className={cn("shrink-0", view.spin && "motion-safe:animate-spin")}
              />
              <span className="sr-only sm:not-sr-only">{view.label}</span>
              {queued > 0 && (
                <span aria-hidden className="sm:hidden">
                  {queued}
                </span>
              )}
            </button>
          </Popover.Trigger>
          <Popover.Content aria-label="Unsynced changes" className="w-80 max-w-[90vw]">
            <div className="flex flex-col gap-r4">
              <div className="flex flex-col gap-r5">
                <Text variant="body-2" weight="semibold">
                  {view.heading}
                </Text>
                <Text variant="body-3" color="secondary" className="leading-snug">
                  {view.description}
                </Text>
              </div>

              {writes.length > 0 ? (
                <ul
                  className="flex max-h-64 flex-col gap-r5 overflow-y-auto"
                  aria-label="Changes waiting to sync"
                >
                  {writes.map((write) => (
                    <li
                      key={write.id ?? write.key}
                      className="flex items-start justify-between gap-r5"
                    >
                      <div className="flex min-w-0 flex-col gap-r6">
                        <Text
                          variant="body-3"
                          className="truncate leading-snug"
                          title={write.label}
                        >
                          {write.label}
                        </Text>
                        <Text variant="body-3" color="muted" className="leading-snug">
                          {formatRelativeTime(write.createdAt)}
                        </Text>
                        {write.stuck && write.lastError && (
                          <Text variant="body-3" className="leading-snug text-status-error">
                            {write.lastError}
                          </Text>
                        )}
                      </div>
                      {write.stuck && write.id !== undefined && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setOpen(false);
                            setDiscarding(write);
                          }}
                        >
                          Discard
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <Text variant="body-3" color="muted">
                  No unsynced changes.
                </Text>
              )}

              {(signInNeeded || (online && queued > 0 && status.state !== "syncing")) && (
                <div className="flex justify-end gap-r5">
                  {signInNeeded ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setOpen(false);
                        void navigate("/login");
                      }}
                    >
                      Sign in
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        retry();
                        setOpen(false);
                      }}
                    >
                      Retry now
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Popover.Content>
        </Popover>
      </span>

      <ConfirmDialog
        open={discarding !== null}
        onClose={() => setDiscarding(null)}
        onConfirm={() => {
          if (discarding?.id !== undefined) discard(discarding.id);
          setDiscarding(null);
        }}
        title="Discard this change?"
        confirmLabel="Discard"
      >
        &ldquo;{discarding?.label}&rdquo; will be deleted from this device and never sent. Anything
        queued after it will then sync.
      </ConfirmDialog>
    </>
  );
}

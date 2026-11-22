import { useCallback, useEffect, useRef } from "react";

import { WRITE_ERROR_CODES } from "@/shared/constants/offline-sync";
import { useToast } from "@/web/components/ui/ToastContext";
import { useSyncRefusals } from "@/web/lib/offline/hooks";
import type { Refusal } from "@/web/lib/offline/outbox";

import { copyMyVersion } from "./copy-my-version";

/** Refusals arriving within this window of the first one share a toast. */
export const REFUSAL_COLLAPSE_MS = 1_000;
const REFUSAL_TOAST_MS = 10_000;
const MAX_LISTED_LABELS = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function conflictTaskTitle(refusal: Refusal): string | null {
  const task = isRecord(refusal.body) ? refusal.body.task : undefined;
  return isRecord(task) && typeof task.title === "string" ? task.title : null;
}

function myDescription(refusal: Refusal): string | null {
  const body = refusal.write.body;
  return isRecord(body) && typeof body.description === "string" ? body.description : null;
}

function listLabels(refusals: Refusal[]): string {
  const shown = refusals.slice(0, MAX_LISTED_LABELS).map((r) => r.write.label);
  const more = refusals.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

/**
 * Reports offline changes the server refused once they replayed. Mount once, inside the toast
 * provider; renders nothing.
 */
export function SyncNotices() {
  const { toast } = useToast();
  const pending = useRef<Refusal[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    const refusals = pending.current;
    pending.current = [];
    if (refusals.length === 0) return;
    if (refusals.length === 1) {
      const [only] = refusals;
      toast(`${only.write.label} — ${only.message}`, {
        variant: "error",
        title: "An offline change couldn't be saved",
        duration: REFUSAL_TOAST_MS,
      });
      return;
    }
    toast(listLabels(refusals), {
      variant: "error",
      title: `${refusals.length} offline changes couldn't be saved`,
      duration: REFUSAL_TOAST_MS,
    });
  }, [toast]);

  const reportConflict = useCallback(
    (refusal: Refusal) => {
      const subject = conflictTaskTitle(refusal);
      const mine = myDescription(refusal);
      toast(
        subject
          ? `Someone else changed the description of “${subject}” while you were offline, so your edit wasn't saved.`
          : "Someone else changed this description while you were offline, so your edit wasn't saved.",
        {
          variant: "warning",
          title: "Description not saved",
          // Stays until dismissed: the person's text exists only in this toast's action.
          duration: 0,
          action:
            mine === null
              ? undefined
              : {
                  label: "Copy my version",
                  onClick: () => copyMyVersion(mine, toast),
                },
        }
      );
    },
    [toast]
  );

  const onRefusal = useCallback(
    (refusal: Refusal) => {
      if (refusal.code === WRITE_ERROR_CODES.descriptionConflict) {
        reportConflict(refusal);
        return;
      }
      pending.current.push(refusal);
      timer.current ??= setTimeout(flush, REFUSAL_COLLAPSE_MS);
    },
    [flush, reportConflict]
  );

  useSyncRefusals(onRefusal);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      flush();
    },
    [flush]
  );

  return null;
}

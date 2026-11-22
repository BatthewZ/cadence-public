import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";

import type { SignOutFlow } from "./use-sign-out";

/** Asks before a sign-out that would delete changes this device hasn't sent yet. */
export function UnsyncedSignOutDialog({ flow }: { flow: SignOutFlow }) {
  const n = flow.unsynced;
  return (
    <ConfirmDialog
      open={n > 0}
      onClose={flow.cancel}
      onConfirm={flow.confirm}
      title="Sign out with unsynced changes?"
      confirmLabel="Sign out anyway"
      confirmingLabel="Signing out…"
      confirming={flow.signingOut}
    >
      {n === 1 ? "1 change hasn't" : `${n} changes haven't`} synced yet. Signing out deletes{" "}
      {n === 1 ? "it" : "them"} from this device.
    </ConfirmDialog>
  );
}

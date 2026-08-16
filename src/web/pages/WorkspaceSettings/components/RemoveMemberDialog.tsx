import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";

export function RemoveMemberDialog({
  open,
  onClose,
  onConfirm,
  removing,
  memberName,
  memberEmail,
  workspaceName,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  removing: boolean;
  memberName: string;
  /**
   * Shown alongside the name because display names are not unique and this
   * action is destructive and unlogged from the actor's side: removal deletes
   * the member's project and team grants outright, and undoing it means a fresh
   * invitation plus re-adding every one of those grants by hand. A roster with
   * two people called the same thing — common enough in any real company, and
   * visible immediately in our own dev data — otherwise gives the admin nothing
   * to tell the rows apart at the moment of confirming.
   */
  memberEmail: string;
  workspaceName: string;
}) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Remove Member"
      confirmLabel="Remove"
      confirmingLabel="Removing..."
      confirming={removing}
    >
      Remove <strong>{memberName}</strong>{memberEmail ? <> (<span className="break-all">{memberEmail}</span>)</> : null} from <strong>{workspaceName}</strong>? They will lose access to all projects and tasks.
    </ConfirmDialog>
  );
}

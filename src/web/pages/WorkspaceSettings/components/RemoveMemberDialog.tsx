import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";

export function RemoveMemberDialog({
  open,
  onClose,
  onConfirm,
  removing,
  memberName,
  workspaceName,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  removing: boolean;
  memberName: string;
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
      Remove <strong>{memberName}</strong> from <strong>{workspaceName}</strong>? They will lose access to all projects and tasks.
    </ConfirmDialog>
  );
}

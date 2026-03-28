import {
  ConfirmDialog,
} from "@/web/components/ui";

export function DeleteTeamDialog({
  open,
  onClose,
  onConfirm,
  teamName,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  teamName: string | undefined;
}) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Delete Team"
      confirmLabel="Delete Team"
    >
      Are you sure you want to delete <strong>{teamName}</strong>? This action
      cannot be undone.
    </ConfirmDialog>
  );
}

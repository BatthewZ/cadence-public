import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";

export function DeleteWebhookDialog({
  open,
  onClose,
  onConfirm,
  webhookName,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  webhookName: string | undefined;
  isPending: boolean;
}) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Delete Webhook"
      confirmLabel="Delete"
      confirmingLabel="Deleting..."
      confirming={isPending}
    >
      Delete <strong>{webhookName}</strong>? This will also remove all delivery
      history. This action cannot be undone.
    </ConfirmDialog>
  );
}

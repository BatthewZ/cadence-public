import { ConfirmDialog } from "@/web/components/ui/ConfirmDialog";

/* ------------------------------------------------------------------ */
/*  RevokeTokenConfirmation                                            */
/*                                                                     */
/*  Destructive-action confirmation matching the project-wide          */
/*  ConfirmDialog pattern. The wording is intentionally specific about */
/*  the immediate 401 consequence so users understand this is not a    */
/*  soft "disable" — it's an instant cut-off.                          */
/* ------------------------------------------------------------------ */

interface RevokeTokenConfirmationProps {
  open: boolean;
  tokenName: string | undefined;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}

export function RevokeTokenConfirmation({
  open,
  tokenName,
  onClose,
  onConfirm,
  isPending,
}: RevokeTokenConfirmationProps) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Revoke API Token"
      confirmLabel="Revoke Token"
      confirmingLabel="Revoking..."
      confirming={isPending}
    >
      Revoke <strong>{tokenName ?? "this token"}</strong>? Any integration
      using it will immediately start receiving <strong>401 Unauthorized</strong>
      {" "}errors. This action cannot be undone.
    </ConfirmDialog>
  );
}

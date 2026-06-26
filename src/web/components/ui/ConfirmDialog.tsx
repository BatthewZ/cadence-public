import type { ReactNode } from "react";

import { Row, Stack } from "@/web/components/layout";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Text } from "./Text";

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  confirmingLabel?: string;
  confirming?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = "Delete",
  confirmingLabel = "Deleting...",
  confirming = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <Stack gap="r4">
        <Text variant="h5" weight="semibold">
          {title}
        </Text>
        <Text variant="body-2" color="secondary">
          {children}
        </Text>
        <Row gap="r4" justify="end" className="pt-r3">
          <Button variant="ghost" size="md" disabled={confirming} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="md" disabled={confirming} onClick={onConfirm}>
            {confirming ? confirmingLabel : confirmLabel}
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}

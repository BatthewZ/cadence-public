import { RefreshCw } from "lucide-react";

import { Row, Stack } from "@/web/components/layout";
import { Alert, Button, Dialog, Text } from "@/web/components/ui";

import { RevealTokenPanel } from "./RevealTokenPanel";

/* ------------------------------------------------------------------ */
/*  RotateTokenDialog                                                  */
/*                                                                     */
/*  Two-phase: confirm rotation -> backend issues sibling token ->     */
/*  reveal new plaintext. The old token continues to work for a 7-day  */
/*  grace window so callers can update their integrations without an   */
/*  outage.                                                            */
/* ------------------------------------------------------------------ */

interface RotateTokenDialogProps {
  open: boolean;
  tokenName: string | undefined;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isPending: boolean;
  errorMessage: string | undefined;
  /** Plaintext returned by the rotate mutation. */
  plaintext: string | null;
  onRevealDismissed: () => void;
}

export function RotateTokenDialog({
  open,
  tokenName,
  onClose,
  onConfirm,
  isPending,
  errorMessage,
  plaintext,
  onRevealDismissed,
}: RotateTokenDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!plaintext) onClose();
      }}
      className="max-w-2xl"
    >
      {plaintext ? (
        <RevealTokenPanel
          heading="Token Rotated"
          banner="The previous token will continue to work for 7 days, then automatically revoke. Update your integrations with the new value below before then."
          plaintext={plaintext}
          onDone={onRevealDismissed}
        />
      ) : (
        <Stack gap="r4">
          <Row gap="r5" align="center">
            <RefreshCw size={18} className="text-accent" />
            <Text variant="h5" weight="semibold">
              Rotate API Token
            </Text>
          </Row>

          <Text variant="body-2" color="secondary">
            Rotate <strong>{tokenName ?? "this token"}</strong>? A new token
            will be issued with the same scopes and project access. The
            previous token will continue to work for 7 days, then
            automatically revoke.
          </Text>

          <Alert variant="info">
            <Text variant="body-3" as="span">
              Use the 7-day grace window to update every place the old token
              is used (CI secrets, environment variables, etc.) before it
              expires.
            </Text>
          </Alert>

          {errorMessage && <Alert variant="error">{errorMessage}</Alert>}

          <Row gap="r4" justify="end" className="pt-r3">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => void onConfirm()}
              disabled={isPending}
            >
              {isPending ? "Rotating..." : "Rotate Token"}
            </Button>
          </Row>
        </Stack>
      )}
    </Dialog>
  );
}

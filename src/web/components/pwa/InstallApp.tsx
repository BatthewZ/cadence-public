import { Download } from "lucide-react";
import { useId } from "react";

import { Row } from "@/web/components/layout/Row";
import { Stack } from "@/web/components/layout/Stack";
import { Button } from "@/web/components/ui/Button";
import { Dialog } from "@/web/components/ui/Dialog";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { Text } from "@/web/components/ui/Text";
import { useInstall } from "@/web/lib/pwa";

type InstallAppMenuItemProps = {
  index: number;
  /**
   * Opens an `InstallHelpDialog` mounted outside the menu: the menu unmounts its items on select.
   * Called when the browser has no install dialog to show (iOS, Firefox, a used-up prompt).
   */
  onShowHelp: () => void;
};

/** "Install app" for a `DropdownMenu.Content`. Renders nothing once Cadence is installed. */
export function InstallAppMenuItem({ index, onShowHelp }: InstallAppMenuItemProps) {
  const { available, installed, install } = useInstall();
  if (installed) return null;

  function handleSelect() {
    if (!available) {
      onShowHelp();
      return;
    }
    void install().then((outcome) => {
      if (outcome === "unavailable") onShowHelp();
    });
  }

  return (
    <DropdownMenu.Item index={index} icon={<Download size={16} />} onSelect={handleSelect}>
      Install app
    </DropdownMenu.Item>
  );
}

type InstallHelpDialogProps = {
  open: boolean;
  onClose: () => void;
};

/** The manual install steps for this browser. */
export function InstallHelpDialog({ open, onClose }: InstallHelpDialogProps) {
  const { help } = useInstall();
  const titleId = useId();

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} className="max-w-md">
      <Stack gap="r4">
        <Text id={titleId} variant="h5" weight="semibold">
          {help.title}
        </Text>
        <ol className="flex list-decimal flex-col gap-r6 pl-r3 text-body-2 text-fg-secondary">
          {help.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <Row justify="end" className="pt-r5">
          <Button size="md" onClick={onClose}>
            Got it
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}

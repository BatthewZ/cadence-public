import type { SyntheticEvent } from "react";

import type { WebhookEventType } from "@/shared/types/webhook";
import { Row, Stack } from "@/web/components/layout";
import { Alert, Button, Dialog, Text } from "@/web/components/ui";

import { SecretDisplay } from "./SecretDisplay";
import { WebhookFormFields } from "./WebhookFormFields";

export function CreateWebhookDialog({
  open,
  onClose,
  name,
  onNameChange,
  url,
  onUrlChange,
  events,
  onEventsChange,
  newSecret,
  onCopiedSecret,
  isPending,
  errorMessage,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  onNameChange: (value: string) => void;
  url: string;
  onUrlChange: (value: string) => void;
  events: WebhookEventType[];
  onEventsChange: (value: WebhookEventType[]) => void;
  newSecret: string | null;
  onCopiedSecret: () => void;
  isPending: boolean;
  errorMessage: string | undefined;
  onSubmit: (e: SyntheticEvent) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      {newSecret ? (
        <Stack gap="r4">
          <Text variant="h5">Webhook Created</Text>
          <SecretDisplay secret={newSecret} label="Webhook Signing Secret" onCopied={onCopiedSecret} />
          <Row justify="end" className="pt-r3">
            <Button variant="primary" size="md" onClick={onClose}>
              Done
            </Button>
          </Row>
        </Stack>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)}>
          <Stack gap="r4">
            <Text variant="h5">Create Webhook</Text>

            <WebhookFormFields
              name={name}
              onNameChange={onNameChange}
              nameId="create-wh-name"
              url={url}
              onUrlChange={onUrlChange}
              urlId="create-wh-url"
              events={events}
              onEventsChange={onEventsChange}
            />

            {errorMessage && (
              <Alert variant="error">{errorMessage}</Alert>
            )}

            <Row gap="r4" justify="end" className="pt-r3">
              <Button
                variant="ghost"
                size="md"
                type="button"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={
                  isPending ||
                  !name.trim() ||
                  !url.trim() ||
                  events.length === 0
                }
              >
                {isPending ? "Creating..." : "Create Webhook"}
              </Button>
            </Row>
          </Stack>
        </form>
      )}
    </Dialog>
  );
}

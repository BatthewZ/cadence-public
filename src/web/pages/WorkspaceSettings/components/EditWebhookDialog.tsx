import { RefreshCw } from "lucide-react";
import type { SyntheticEvent } from "react";

import type { WebhookEventType } from "@/shared/types/webhook";
import { Divider, Row, Stack } from "@/web/components/layout";
import { Alert, Button, Dialog, Text } from "@/web/components/ui";

import { SecretDisplay } from "./SecretDisplay";
import { type ProjectOption, WebhookFormFields } from "./WebhookFormFields";

export function EditWebhookDialog({
  open,
  onClose,
  name,
  onNameChange,
  url,
  onUrlChange,
  events,
  onEventsChange,
  active,
  onActiveChange,
  projectId,
  onProjectIdChange,
  projects,
  fixedProjectScope,
  fieldErrors,
  onClearFieldError,
  regeneratedSecret,
  onCopiedSecret,
  isPending,
  errorMessage,
  onSubmit,
  onRegenerateSecret,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  onNameChange: (value: string) => void;
  url: string;
  onUrlChange: (value: string) => void;
  events: WebhookEventType[];
  onEventsChange: (value: WebhookEventType[]) => void;
  active: boolean;
  onActiveChange: (value: boolean) => void;
  projectId: string | null;
  onProjectIdChange: (value: string | null) => void;
  projects: ProjectOption[];
  fixedProjectScope?: boolean;
  fieldErrors?: Record<string, string>;
  onClearFieldError?: (field: string) => void;
  regeneratedSecret: string | null;
  onCopiedSecret: () => void;
  isPending: boolean;
  errorMessage: string | undefined;
  onSubmit: (e: SyntheticEvent) => void;
  onRegenerateSecret: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      {regeneratedSecret ? (
        <Stack gap="r4">
          <Text variant="h5">Secret Regenerated</Text>
          <SecretDisplay secret={regeneratedSecret} label="New Webhook Secret" onCopied={onCopiedSecret} />
          <Row justify="end" className="pt-r3">
            <Button variant="primary" size="md" onClick={onClose}>
              Done
            </Button>
          </Row>
        </Stack>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)}>
          <Stack gap="r4">
            <Text variant="h5">Edit Webhook</Text>

            <WebhookFormFields
              name={name}
              onNameChange={onNameChange}
              nameId="edit-wh-name"
              url={url}
              onUrlChange={onUrlChange}
              urlId="edit-wh-url"
              events={events}
              onEventsChange={onEventsChange}
              active={active}
              onActiveChange={onActiveChange}
              projectId={projectId}
              onProjectIdChange={onProjectIdChange}
              projects={projects}
              fixedProjectScope={fixedProjectScope}
              fieldErrors={fieldErrors}
              onClearFieldError={onClearFieldError}
            />

            <Divider />
            <Row gap="r5" align="center">
              <RefreshCw size={14} className="text-fg-muted" />
              <Text variant="body-3" color="muted">
                Need a new signing secret?
              </Text>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => void onRegenerateSecret()}
                disabled={isPending}
              >
                Regenerate Secret
              </Button>
            </Row>

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
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </Row>
          </Stack>
        </form>
      )}
    </Dialog>
  );
}

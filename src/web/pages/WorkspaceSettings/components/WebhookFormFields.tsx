import type { WebhookEventType } from "@/shared/types/webhook";
import { Checkbox, Field, Input, Label } from "@/web/components/form";
import { Divider } from "@/web/components/layout";
import { Text } from "@/web/components/ui";

import { WebhookEventSelector } from "./WebhookEventSelector";

export function WebhookFormFields({
  name,
  onNameChange,
  nameId,
  url,
  onUrlChange,
  urlId,
  events,
  onEventsChange,
  active,
  onActiveChange,
}: {
  name: string;
  onNameChange: (value: string) => void;
  nameId: string;
  url: string;
  onUrlChange: (value: string) => void;
  urlId: string;
  events: WebhookEventType[];
  onEventsChange: (value: WebhookEventType[]) => void;
  active?: boolean;
  onActiveChange?: (value: boolean) => void;
}) {
  return (
    <>
      <Field>
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="My webhook"
        />
      </Field>

      <Field>
        <Label htmlFor={urlId}>URL</Label>
        <Input
          id={urlId}
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://example.com/webhook"
        />
        <Text variant="body-3" color="muted">
          Must use HTTPS.
        </Text>
      </Field>

      {onActiveChange !== undefined && active !== undefined && (
        <Field>
          <Label>Status</Label>
          <label className="flex items-center gap-r5 cursor-pointer">
            <Checkbox
              checked={active}
              onChange={(e) => onActiveChange(e.target.checked)}
            />
            <Text variant="body-2" as="span">
              {active ? "Active" : "Disabled"}
            </Text>
          </label>
        </Field>
      )}

      <Divider />
      <Text variant="body-2" weight="semibold">
        Events
      </Text>
      <WebhookEventSelector value={events} onChange={onEventsChange} />
    </>
  );
}

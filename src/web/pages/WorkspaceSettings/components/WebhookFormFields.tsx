import { type WebhookEventType, WORKSPACE_SCOPED_EVENTS } from "@/shared/types/webhook";
import { Checkbox, Field, Input, Label, Select } from "@/web/components/form";
import { Divider } from "@/web/components/layout";
import { Text } from "@/web/components/ui";

import { WebhookEventSelector } from "./WebhookEventSelector";

export interface ProjectOption {
  id: string;
  name: string;
}

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
  projectId,
  onProjectIdChange,
  projects,
  /** When true, the project selector is hidden and events are always project-scoped. */
  fixedProjectScope,
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
  projectId: string | null;
  onProjectIdChange?: (value: string | null) => void;
  projects?: ProjectOption[];
  fixedProjectScope?: boolean;
}) {
  function handleProjectChange(value: string) {
    const newProjectId = value || null;
    onProjectIdChange?.(newProjectId);
    // When scoping to a project, remove any workspace-scoped events
    if (newProjectId) {
      const filtered = events.filter((e) => !WORKSPACE_SCOPED_EVENTS.has(e));
      if (filtered.length !== events.length) {
        onEventsChange(filtered);
      }
    }
  }

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

      {!fixedProjectScope && projects && onProjectIdChange && (
        <Field>
          <Label htmlFor="wh-project-scope">Project scope</Label>
          <Select
            id="wh-project-scope"
            value={projectId ?? ""}
            onChange={(e) => handleProjectChange(e.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Text variant="body-3" color="muted">
            Optionally limit this webhook to events from a specific project.
          </Text>
        </Field>
      )}

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
      <WebhookEventSelector value={events} onChange={onEventsChange} projectScoped={fixedProjectScope || !!projectId} />
    </>
  );
}

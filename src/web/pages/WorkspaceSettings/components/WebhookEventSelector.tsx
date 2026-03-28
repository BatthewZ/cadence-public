import { WEBHOOK_EVENT_GROUPS, type WebhookEventType } from "@/shared/types/webhook";
import { Checkbox } from "@/web/components/form";
import { Stack } from "@/web/components/layout";
import { Text } from "@/web/components/ui";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Converts a dot-delimited event name into a human-readable label.
 *
 * "task.created"         -> "Created"
 * "task.comment_created" -> "Comment created"
 * "task.label_added"     -> "Label added"
 * "task.due_soon"        -> "Due soon"
 */
function humanLabel(event: string): string {
  const suffix = event.split(".").slice(1).join(".");
  return suffix.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface WebhookEventSelectorProps {
  value: WebhookEventType[];
  onChange: (events: WebhookEventType[]) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Grouped checkbox selector for webhook event types.
 *
 * Renders checkboxes grouped by domain (Task, Project, Workspace, Invitation)
 * using the shared WEBHOOK_EVENT_GROUPS constant. Each group includes a
 * "Select all" toggle for fast bulk selection.
 */
export function WebhookEventSelector({ value, onChange }: WebhookEventSelectorProps) {
  const selected = new Set(value);

  function toggleEvent(event: WebhookEventType) {
    const next = new Set(selected);
    if (next.has(event)) {
      next.delete(event);
    } else {
      next.add(event);
    }
    onChange([...next]);
  }

  function toggleGroup(events: readonly WebhookEventType[], allSelected: boolean) {
    const next = new Set(selected);
    if (allSelected) {
      for (const e of events) next.delete(e);
    } else {
      for (const e of events) next.add(e);
    }
    onChange([...next]);
  }

  return (
    <Stack gap="r4">
      {Object.entries(WEBHOOK_EVENT_GROUPS).map(([groupName, events]) => {
        const allInGroupSelected = events.every((e) => selected.has(e));
        const someInGroupSelected = events.some((e) => selected.has(e));

        return (
          <div key={groupName} className="border border-border-default/50 rounded-lg p-r4">
            <label className="flex items-center gap-r5 cursor-pointer mb-r5">
              <Checkbox
                checked={allInGroupSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someInGroupSelected && !allInGroupSelected;
                }}
                onChange={() => toggleGroup(events, allInGroupSelected)}
                aria-label={`Select all ${groupName} events`}
              />
              <Text variant="body-2" weight="semibold" as="span">
                {groupName}
              </Text>
              <Text variant="body-3" color="muted" as="span">
                ({events.length} events)
              </Text>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-r6 pl-r3">
              {events.map((event) => (
                <label key={event} className="flex items-center gap-r5 cursor-pointer py-r6">
                  <Checkbox
                    checked={selected.has(event)}
                    onChange={() => toggleEvent(event)}
                    aria-label={event}
                  />
                  <Text variant="body-3" as="span">
                    {humanLabel(event)}
                  </Text>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </Stack>
  );
}

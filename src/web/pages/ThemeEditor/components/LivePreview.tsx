import { Field, Input, Label } from "@/web/components/form";
import { Divider, Row, Stack } from "@/web/components/layout";
import {
  Alert,
  Badge,
  Button,
  Card,
  ProgressBar,
  Text,
} from "@/web/components/ui";
import { cn } from "@/web/util/style/style";

function LivePreview() {
  return (
    <Card padding="r3" shadow="lg" className="sticky top-6">
      <Stack gap="r5">
        <Text variant="h6">Live Preview</Text>
        <Divider />

        {/* Typography */}
        <Stack gap="r6">
          <Text variant="h4">Heading</Text>
          <Text variant="body-1">
            Body text in the primary color, showing how your theme affects readable content.
          </Text>
          <Text variant="body-2" color="secondary">
            Secondary text for supporting content and metadata.
          </Text>
          <Text variant="body-3" color="muted">
            Muted text for subtle hints and timestamps.
          </Text>
        </Stack>

        <Divider />

        {/* Buttons */}
        <Row gap="r5" wrap>
          <Button size="sm">Primary</Button>
          <Button size="sm" variant="secondary">
            Secondary
          </Button>
          <Button size="sm" variant="ghost">
            Ghost
          </Button>
          <Button size="sm" variant="danger">
            Danger
          </Button>
        </Row>

        <Divider />

        {/* Badges */}
        <Row gap="r5" wrap>
          <Badge>Default</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="error">Error</Badge>
          <Badge variant="info">Info</Badge>
        </Row>

        <Divider />

        {/* Alerts */}
        <Stack gap="r6">
          <Alert variant="info">Info alert message</Alert>
          <Alert variant="success">Success alert message</Alert>
          <Alert variant="warning">Warning alert message</Alert>
          <Alert variant="error">Error alert message</Alert>
        </Stack>

        <Divider />

        {/* Progress */}
        <Stack gap="r6">
          <ProgressBar value={65} color="accent" size="md" />
          <ProgressBar value={40} color="success" size="sm" />
        </Stack>

        <Divider />

        {/* Surfaces */}
        <div className="grid grid-cols-4 gap-r6">
          {([0, 1, 2, 3] as const).map((n) => (
            <div
              key={n}
              className={cn(
                "rounded-md p-r5 text-center text-body-3 text-fg-secondary border border-border-default",
                n === 0 && "bg-surface-0",
                n === 1 && "bg-surface-1",
                n === 2 && "bg-surface-2",
                n === 3 && "bg-surface-3"
              )}
            >
              S-{n}
            </div>
          ))}
        </div>

        <Divider />

        {/* Card inside card for depth */}
        <Card padding="r4" shadow="sm" className="bg-surface-1">
          <Stack gap="r6">
            <Text variant="body-2" weight="semibold">
              Nested card
            </Text>
            <Text variant="body-3" color="secondary">
              Testing surface layering, border, and shadow tokens together.
            </Text>
            <Row gap="r5">
              <div className="w-8 h-8 rounded-sm bg-accent" />
              <div className="w-8 h-8 rounded-sm bg-primary" />
              <div className="w-8 h-8 rounded-sm bg-secondary" />
            </Row>
          </Stack>
        </Card>

        {/* Input preview */}
        <Field>
          <Label>Sample Input</Label>
          <Input placeholder="Type something..." />
        </Field>
      </Stack>
    </Card>
  );
}

export { LivePreview };

import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { Row } from "@/web/components/layout/Row";
import { Stack } from "@/web/components/layout/Stack";
import { Button } from "@/web/components/ui/Button";
import { Card } from "@/web/components/ui/Card";
import { Text } from "@/web/components/ui/Text";
import { useUpdatePrompt } from "@/web/lib/pwa";

/**
 * Non-blocking "new version" card, bottom-left so it never covers the toasts (bottom-right).
 * Mount once, app-wide; it renders nothing until a new service worker is waiting.
 */
export function UpdatePrompt() {
  const { ready, apply, dismiss } = useUpdatePrompt();
  const [reloading, setReloading] = useState(false);

  return (
    // The live region stays mounted: screen readers skip regions inserted with their content.
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed z-50 left-r4 right-r4 bottom-[calc(var(--spacing-r4)+env(safe-area-inset-bottom))] sm:right-auto sm:w-96"
    >
      {ready && (
        <Card padding="r4" shadow="lg" className="fade-up pointer-events-auto">
          <Stack gap="r4">
            <Row gap="r4" align="start">
              <span className="flex shrink-0 items-center justify-center rounded-full bg-accent-subtle p-r5 text-accent">
                <RefreshCw size={16} aria-hidden="true" />
              </span>
              <Stack gap="r6" className="min-w-0">
                <Text variant="body-2" weight="semibold">
                  A new version of Cadence is available
                </Text>
                <Text variant="body-3" color="secondary">
                  Reload to start using it.
                </Text>
              </Stack>
            </Row>
            <Row gap="r5" justify="end">
              <Button variant="ghost" size="sm" onClick={dismiss} disabled={reloading}>
                Not now
              </Button>
              <Button
                size="sm"
                disabled={reloading}
                onClick={() => {
                  setReloading(true);
                  apply();
                }}
              >
                {reloading ? "Reloading…" : "Reload"}
              </Button>
            </Row>
          </Stack>
        </Card>
      )}
    </div>
  );
}

import { Stack } from "@/web/components/layout";

import { Alert } from "./Alert";
import { Button } from "./Button";

interface QueryErrorRetryProps {
  message: string;
  onRetry: () => void | Promise<unknown>;
}

/**
 * Standardized error + retry UI for failed query states.
 * Reduces duplication across pages that share the same error-recovery pattern.
 */
export function QueryErrorRetry({ message, onRetry }: QueryErrorRetryProps) {
  return (
    <Stack gap="r3" className="items-center py-r6">
      <Alert variant="error">{message}</Alert>
      <Button variant="ghost" size="sm" onClick={() => { void onRetry(); }}>
        Retry
      </Button>
    </Stack>
  );
}

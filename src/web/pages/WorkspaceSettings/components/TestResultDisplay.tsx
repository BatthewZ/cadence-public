import { Stack } from "@/web/components/layout";
import { Alert, Text } from "@/web/components/ui";

export interface TestDeliveryResult {
  id: string;
  success: boolean;
  statusCode: number | null;
  response: string | null;
}

export function TestResultDisplay({
  testResult,
}: {
  testResult: TestDeliveryResult;
}) {
  return (
    <Alert variant={testResult.success ? "success" : "error"}>
      <Stack gap="r6">
        <Text variant="body-2" weight="semibold" as="span">
          Test delivery {testResult.success ? "succeeded" : "failed"}
        </Text>
        {testResult.statusCode !== null && (
          <Text variant="body-3" as="span">
            HTTP {testResult.statusCode}
          </Text>
        )}
        {testResult.response && (
          <code className="text-body-3 font-mono break-all">
            {testResult.response.slice(0, 200)}
          </code>
        )}
      </Stack>
    </Alert>
  );
}

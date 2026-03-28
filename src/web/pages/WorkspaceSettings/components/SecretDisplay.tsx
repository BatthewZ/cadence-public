import { ClipboardCopy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Row, Stack } from "@/web/components/layout";
import { Alert, Button, Text } from "@/web/components/ui";

export function SecretDisplay({
  secret,
  label,
  onCopied,
}: {
  secret: string;
  label: string;
  onCopied?: () => void;
}) {
  const [visible, setVisible] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(secret).then(() => onCopied?.());
  }

  return (
    <Alert variant="warning">
      <Stack gap="r5" className="w-full">
        <Text variant="body-2" weight="semibold" as="span">
          {label}
        </Text>
        <Text variant="body-3" color="muted" as="span">
          This secret will only be shown once. Copy it now and store it securely.
        </Text>
        <Row gap="r5" align="center" className="mt-r6">
          <code className="flex-1 bg-surface-2 rounded-md px-r4 py-r5 text-body-3 font-mono break-all select-all">
            {visible ? secret : "\u2022".repeat(32)}
          </code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide secret" : "Show secret"}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopy} aria-label="Copy secret">
            <ClipboardCopy size={16} />
          </Button>
        </Row>
      </Stack>
    </Alert>
  );
}

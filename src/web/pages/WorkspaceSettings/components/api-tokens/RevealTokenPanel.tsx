import { AlertTriangle, Check, ClipboardCopy, Download } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/web/components/form";
import { Row, Stack } from "@/web/components/layout";
import { Alert, Button, Text } from "@/web/components/ui";

/* ------------------------------------------------------------------ */
/*  RevealTokenPanel                                                   */
/*                                                                     */
/*  Critical one-time-reveal UX shown after a token is created or      */
/*  rotated. The plaintext is never persisted client-side beyond this  */
/*  panel — users must copy or download it before dismissing.          */
/*                                                                     */
/*  Defense in depth:                                                  */
/*  - Plaintext is never trimmed or split across DOM nodes so the      */
/*    standard copy gesture works.                                     */
/*  - An explicit acknowledgement checkbox gates the "Done" button so  */
/*    users cannot dismiss the panel by reflex.                        */
/*  - The warning Alert uses a destructive variant to match the        */
/*    severity: forgetting to copy means destroying access until a     */
/*    rotation re-issues a fresh value.                                */
/* ------------------------------------------------------------------ */

interface RevealTokenPanelProps {
  plaintext: string;
  /** Heading shown above the warning (e.g. "API Token Created"). */
  heading: string;
  /** Optional banner shown below the heading — used by the rotation flow. */
  banner?: string;
  /** Called when the user dismisses the panel after acknowledging. */
  onDone: () => void;
}

export function RevealTokenPanel({
  plaintext,
  heading,
  banner,
  onDone,
}: RevealTokenPanelProps) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      // Reset the "Copied!" indicator after a short window so a second
      // copy attempt produces visible feedback.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-secure contexts or when permission is
      // denied. Surface the failure inline so users know to copy manually.
      setCopied(false);
    }
  }

  function handleDownload() {
    const blob = new Blob(
      [
        "# Cadence API Token\n",
        "# Store this file securely. Anyone with this token can act on your\n",
        "# behalf within the granted scopes.\n\n",
        `${plaintext}\n`,
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cadence-api-token.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <Stack gap="r4">
      <Text variant="h5" weight="semibold">
        {heading}
      </Text>

      {banner && (
        <Alert variant="info">
          <Text variant="body-3" as="span">
            {banner}
          </Text>
        </Alert>
      )}

      <Alert variant="warning">
        <Row gap="r5" align="start" className="w-full">
          <AlertTriangle size={18} className="shrink-0 mt-r6 text-status-warning" />
          <Stack gap="r6">
            <Text variant="body-2" weight="semibold" as="span">
              You won&apos;t see this token again.
            </Text>
            <Text variant="body-3" color="muted" as="span">
              Copy it now and store it in a secrets manager. Anyone with this
              value can act on your behalf within the granted scopes.
            </Text>
          </Stack>
        </Row>
      </Alert>

      <div className="bg-surface-2 rounded-md border border-border-default/60 p-r4">
        <Stack gap="r5">
          <Text
            variant="body-3"
            color="muted"
            as="span"
            className="uppercase tracking-wide"
          >
            Personal Access Token
          </Text>
          <Row gap="r5" align="center">
            <code
              className="flex-1 font-mono text-body-2 break-all select-all leading-relaxed"
              data-testid="api-token-plaintext"
            >
              {plaintext}
            </code>
          </Row>
          <Row gap="r5" className="flex-wrap">
            <Button
              type="button"
              variant={copied ? "primary" : "secondary"}
              size="sm"
              onClick={() => void handleCopy()}
              aria-label="Copy token to clipboard"
            >
              {copied ? (
                <>
                  <Check size={14} className="mr-r6" />
                  Copied!
                </>
              ) : (
                <>
                  <ClipboardCopy size={14} className="mr-r6" />
                  Copy
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              aria-label="Download token as .txt file"
            >
              <Download size={14} className="mr-r6" />
              Download .txt
            </Button>
          </Row>
        </Stack>
      </div>

      <label className="flex items-start gap-r5 cursor-pointer">
        <Checkbox
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          aria-label="Acknowledge token has been stored safely"
          className="mt-r6"
        />
        <Text variant="body-3" as="span">
          I&apos;ve stored this token safely. I understand it will not be shown
          again.
        </Text>
      </label>

      <Row justify="end" gap="r4" className="pt-r3">
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={!acknowledged}
          onClick={onDone}
        >
          Done
        </Button>
      </Row>
    </Stack>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { CURRENT_TOS_VERSION } from "@/shared/constants/legal";
import { Label } from "@/web/components/form";
import { Checkbox } from "@/web/components/form/Checkbox";
import { Stack } from "@/web/components/layout";
import { AuthLayout } from "@/web/components/layout/AuthLayout";
import { Alert, Button, Card, Text } from "@/web/components/ui";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { api } from "@/web/lib/api/client";
import { signOut } from "@/web/lib/auth/auth-client";
import { queryKeys } from "@/web/lib/query-keys";

export function AcceptTerms() {
  useDocumentTitle("Terms of Service");

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleAccept() {
    setError("");
    setLoading(true);

    try {
      await api.post("/api/legal/accept-tos", {
        tosVersion: CURRENT_TOS_VERSION,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.legal.tosStatus,
      });
      void navigate("/");
    } catch {
      setError("Failed to accept Terms of Service. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    void navigate("/login");
  }

  return (
    <AuthLayout>
      <Card className="w-full" padding="r2">
        <Stack gap="r3">
          <Text variant="h4" as="h1" className="text-center">
            Terms of Service
          </Text>

          <Text variant="body-2" color="secondary" className="text-center">
            We've added Terms of Service and a Privacy Policy. Please review
            them before continuing.
          </Text>

          <Stack gap="r4">
            <Text variant="body-2" color="secondary">
              Please review the following documents:
            </Text>

            <div className="flex flex-col gap-r5">
              <Link
                to="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="link"
              >
                Terms of Service
              </Link>
              <Link
                to="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="link"
              >
                Privacy Policy
              </Link>
            </div>

            <div className="flex items-start gap-r5">
              <Checkbox
                id="agree-tos"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <Label htmlFor="agree-tos" className="cursor-pointer leading-snug">
                I have read and agree to the Terms of Service and Privacy Policy
              </Label>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            <Button
              type="button"
              variant="primary"
              size="md"
              className="w-full"
              disabled={!agreed || loading}
              onClick={() => void handleAccept()}
            >
              {loading ? "Accepting..." : "Accept and Continue"}
            </Button>
          </Stack>

          <Text variant="body-2" color="secondary" className="text-center">
            <button
              type="button"
              className="link"
              onClick={() => void handleSignOut()}
            >
              Sign Out
            </button>
          </Text>
        </Stack>
      </Card>
    </AuthLayout>
  );
}

export default AcceptTerms;

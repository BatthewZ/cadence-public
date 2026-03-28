import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import type { Invitation } from "@/shared/types/invitations";
import { Center, Container, Stack } from "@/web/components/layout";
import { Alert, Badge, Button, Card, Spinner, Text } from "@/web/components/ui";
import { useToast } from "@/web/components/ui/ToastContext";
import { api } from "@/web/lib/api/client";
import { useSession } from "@/web/lib/auth/auth-client";
import { queryKeys } from "@/web/lib/query-keys";

interface AcceptResult {
  ok: boolean;
  workspaceId: string;
}

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const session = useSession();
  const isAuthenticated = !!session.data?.session;

  const {
    data: invitationData,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: queryKeys.invitations.byToken(token ?? ""),
    queryFn: () => api.get<{ invitation: Invitation }>(`/api/invitations/${token}`),
    enabled: !!token,
  });
  const invitation = invitationData?.invitation ?? null;

  const qc = useQueryClient();
  const {
    mutateAsync: acceptInvitation,
    isPending: accepting,
    error: acceptMutationError,
  } = useMutation({
    mutationFn: (input: { token: string }) =>
      api.post<AcceptResult>("/api/invitations/accept", input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
  const acceptError = acceptMutationError?.message ?? null;

  async function handleAccept() {
    if (!token) return;
    try {
      await acceptInvitation({ token });
      toast("You have joined the workspace!", { variant: "success" });
      void navigate("/workspaces");
    } catch {
      toast("Failed to accept invitation. Please try again.", { variant: "error" });
    }
  }

  function handleDecline() {
    void navigate("/");
  }

  const redirectPath = `/invite/${token}`;

  return (
    <Center className="min-h-screen bg-surface-1">
      <Container size="sm">
        <Card padding="r2">
          <Stack gap="r3">
            <Text variant="h3" as="h1" className="text-center">
              You're Invited!
            </Text>

            {loading && (
              <Center className="py-r2">
                <Spinner size="lg" />
              </Center>
            )}

            {error && (
              <Alert variant="error">{error.message}</Alert>
            )}

            {acceptError && (
              <Alert variant="error">{acceptError}</Alert>
            )}

            {invitation && (
              <Stack gap="r4">
                <Text variant="body-1" color="secondary" className="text-center">
                  {invitation.invitedBy?.name ?? "Someone"} invited you to join
                </Text>
                <Text variant="h4" as="h2" className="text-center">
                  {invitation.workspace?.name ?? "a workspace"}
                </Text>
                <Center>
                  <Badge variant="info">Role: {invitation.role}</Badge>
                </Center>

                {isAuthenticated ? (
                  <Stack gap="r5">
                    <Button
                      variant="primary"
                      className="w-full"
                      onClick={() => void handleAccept()}
                      disabled={accepting}
                    >
                      {accepting ? "Accepting..." : "Accept Invitation"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full"
                      onClick={handleDecline}
                    >
                      Decline
                    </Button>
                  </Stack>
                ) : (
                  <Stack gap="r5">
                    <Text variant="body-2" color="muted" className="text-center">
                      Sign in or create an account to accept this invitation
                    </Text>
                    <Button
                      variant="primary"
                      className="w-full"
                      onClick={() =>
                        void navigate(`/login?redirect=${encodeURIComponent(redirectPath)}`)
                      }
                    >
                      Sign In
                    </Button>
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={() =>
                        void navigate(`/register?redirect=${encodeURIComponent(redirectPath)}`)
                      }
                    >
                      Create Account
                    </Button>
                  </Stack>
                )}
              </Stack>
            )}

            {/* Non-pending/expired invitations are handled by the API error response above */}
          </Stack>
        </Card>
      </Container>
    </Center>
  );
}

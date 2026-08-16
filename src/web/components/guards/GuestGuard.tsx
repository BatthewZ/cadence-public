import { Navigate } from "react-router-dom";

import { Center } from "@/web/components/layout/Center";
import { Spinner } from "@/web/components/ui/Spinner";
import { useGuestSession } from "@/web/lib/auth/use-guest-session";

export function GuestGuard({ children }: { children: React.ReactNode }) {
  // `useGuestSession` rather than `useSession`: the spinner must appear only
  // while the session is genuinely unknown. Showing it on a later refetch
  // unmounts the guest page and destroys its state — see the hook's docs for
  // the registration confirmation this silently ate.
  const { session, showInitialLoader } = useGuestSession();

  if (showInitialLoader) {
    return (
      <Center className="min-h-screen">
        <Spinner size="lg" />
      </Center>
    );
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

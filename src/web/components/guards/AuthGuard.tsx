import { Navigate } from "react-router-dom";

import { Center } from "@/web/components/layout/Center";
import { Spinner } from "@/web/components/ui/Spinner";
import { useSession } from "@/web/lib/auth/auth-client";
import { OfflineProvider } from "@/web/lib/offline/OfflineProvider";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <Center className="min-h-screen">
        <Spinner size="lg" />
      </Center>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <OfflineProvider userId={session.user.id}>{children}</OfflineProvider>;
}

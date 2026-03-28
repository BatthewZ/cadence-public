import { lazy, Suspense } from "react";
import { Navigate } from "react-router-dom";

import { Center } from "@/web/components/layout";
import { Spinner } from "@/web/components/ui";
import { useSession } from "@/web/lib/auth/auth-client";

const Landing = lazy(() => import("@/web/pages/Landing/Landing"));

export function HomeRedirect() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <Center className="min-h-screen">
        <Spinner size="lg" />
      </Center>
    );
  }

  if (!session) {
    return (
      <Suspense
        fallback={
          <Center className="min-h-screen">
            <Spinner size="lg" />
          </Center>
        }
      >
        <Landing />
      </Suspense>
    );
  }

  const lastSlug = localStorage.getItem("lastWorkspaceSlug");
  if (lastSlug) {
    return <Navigate to={`/w/${lastSlug}/dashboard`} replace />;
  }

  return <Navigate to="/workspaces" replace />;
}

import { lazy, Suspense } from "react";
import { Navigate } from "react-router-dom";

import { Center } from "@/web/components/layout";
import { Spinner } from "@/web/components/ui";
import { useGuestSession } from "@/web/lib/auth/use-guest-session";

const Landing = lazy(() => import("@/web/pages/Landing/Landing"));

export function HomeRedirect() {
  // `useGuestSession`, not `useSession` — and the reason is this component's
  // own, not inherited from `GuestGuard`. For a logged-out visitor Better Auth
  // re-arms `isPending` on every background refetch (window focus, tab
  // visibility, storage events, coming back online). `<Landing />` is rendered
  // *inside* this component, so keying the spinner off `isPending` replaced the
  // landing page with a full-screen spinner on a plain tab-switch and remounted
  // it on the way back — losing scroll position and closing an open mobile nav.
  //
  // The session question itself is unchanged: the only outcome that matters
  // here is a session appearing, and that is acted on below on the very next
  // render. Nothing is rendered less safely — a logged-out visitor sees the
  // public landing page either way.
  const { session, showInitialLoader } = useGuestSession();

  if (showInitialLoader) {
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

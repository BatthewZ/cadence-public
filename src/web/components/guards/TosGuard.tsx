import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { Center } from "@/web/components/layout/Center";
import { OfflineUnavailable } from "@/web/components/sync/OfflineUnavailable";
import { isUnavailableOffline } from "@/web/components/sync/use-online-only";
import { QueryErrorRetry } from "@/web/components/ui/QueryErrorRetry";
import { Spinner } from "@/web/components/ui/Spinner";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

type TosStatusResponse = {
  accepted: boolean;
  currentVersion: string;
};

export function TosGuard({ children }: { children: React.ReactNode }) {
  const query = useQuery({
    queryKey: queryKeys.legal.tosStatus,
    queryFn: () => api.get<TosStatusResponse>("/api/legal/tos-status"),
    staleTime: 5 * 60 * 1000,
  });
  const { data, isPending, isError, refetch } = query;

  if (isUnavailableOffline(query)) {
    return <OfflineUnavailable what="Cadence" className="min-h-screen" />;
  }

  if (isPending) {
    return (
      <Center className="min-h-screen">
        <Spinner size="lg" />
      </Center>
    );
  }

  if (isError) {
    return (
      <Center className="min-h-screen">
        <QueryErrorRetry message="Failed to check Terms of Service status." onRetry={refetch} />
      </Center>
    );
  }

  if (!data?.accepted) {
    return <Navigate to="/accept-terms" replace />;
  }

  return <>{children}</>;
}

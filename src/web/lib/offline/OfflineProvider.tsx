import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";

import { Center } from "@/web/components/layout/Center";
import { Spinner } from "@/web/components/ui/Spinner";

import { isRuntimeReady, startOfflineRuntime } from "./runtime";

/**
 * Starts offline mode for the signed-in account and renders its children once the saved cache
 * is back in memory, so guards and pages read saved data on their first render.
 */
export function OfflineProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [readyFor, setReadyFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void startOfflineRuntime(userId, queryClient).finally(() => {
      if (!cancelled) setReadyFor(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, queryClient]);

  if (readyFor !== userId && !isRuntimeReady(userId)) {
    return (
      <Center className="min-h-screen">
        <Spinner size="lg" />
      </Center>
    );
  }
  return <>{children}</>;
}

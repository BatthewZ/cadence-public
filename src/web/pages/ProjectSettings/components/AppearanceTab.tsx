import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Palette, RotateCcw } from "lucide-react";

import type { Theme } from "@/shared/types/theme";
import { Row, Stack } from "@/web/components/layout";
import {
  Button,
  Card,
  Text,
} from "@/web/components/ui";
import { ThemeGrid } from "@/web/components/ui/ThemeGrid";
import type { useToast } from "@/web/components/ui/ToastContext";
import type { useProject } from "@/web/contexts/ProjectContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";
import { THEME_LABELS } from "@/web/lib/theme-constants";

export function AppearanceTab({
  projectId,
  project,
  refetch,
  toast,
}: {
  projectId: string;
  project: ReturnType<typeof useProject>["project"];
  refetch: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const qc = useQueryClient();
  const { workspace } = useWorkspace();

  const { mutate: updateTheme, isPending: themeSaving } = useMutation({
    mutationFn: (theme: Theme | null) =>
      api.patch(`/api/projects/${projectId}`, { theme }),
    onMutate: async (newTheme) => {
      await qc.cancelQueries({ queryKey: queryKeys.projects.detail(projectId) });
      const previousData = qc.getQueryData(queryKeys.projects.detail(projectId));
      qc.setQueryData(
        queryKeys.projects.detail(projectId),
        (old: { project: Record<string, unknown> } | undefined) =>
          old ? { ...old, project: { ...old.project, theme: newTheme } } : old,
      );
      return { previousData };
    },
    onError: (_err, _newTheme, context) => {
      if (context?.previousData) {
        qc.setQueryData(queryKeys.projects.detail(projectId), context.previousData);
      }
      toast("Failed to update theme.", { variant: "error" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      toast("Project theme updated.", { variant: "success" });
      refetch();
    },
  });

  const activeTheme = (project.theme ?? null) as Theme | null;
  const workspaceTheme = (workspace.theme ?? "default") as Theme;
  const hasOverride = activeTheme != null;

  return (
    <Card>
      <Stack gap="r4">
        <Row gap="r5" align="center">
          <Palette size={18} className="text-accent" />
          <Text variant="h5">Project Theme</Text>
        </Row>
        <Text variant="body-2" color="secondary">
          Override the workspace theme for this project. All project members will see this theme
          when viewing the project.
        </Text>

        {hasOverride && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={themeSaving}
              onClick={() => updateTheme(null)}
            >
              <RotateCcw size={14} />
              Use Workspace Theme ({THEME_LABELS[workspaceTheme]})
            </Button>
          </div>
        )}

        {!hasOverride && (
          <Text variant="body-3" color="muted">
            Currently inheriting the workspace theme: <strong>{THEME_LABELS[workspaceTheme]}</strong>
          </Text>
        )}

        <ThemeGrid
          activeTheme={hasOverride ? activeTheme : null}
          onSelect={(t) => updateTheme(t)}
          disabled={themeSaving}
          highlightedTheme={!hasOverride ? workspaceTheme : undefined}
        />
      </Stack>
    </Card>
  );
}

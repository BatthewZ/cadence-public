import { Archive, CheckCircle2 } from "lucide-react";

import { Row } from "@/web/components/layout";
import { Text } from "@/web/components/ui";

import type { DashboardStatsResponse } from "./types";

const ARCHIVED_STATUS_ICON: Record<string, typeof Archive> = {
  archived: Archive,
  completed: CheckCircle2,
};

function ArchivedProjectsSummary({
  archivedSummary,
}: {
  archivedSummary: DashboardStatsResponse["archivedSummary"];
}) {
  const entries = archivedSummary.filter((e) => e.projectCount > 0);
  if (entries.length === 0) return null;

  return (
    <Row gap="r3" align="center" className="flex-wrap px-r5">
      {entries.map((entry) => {
        const Icon = ARCHIVED_STATUS_ICON[entry.status] ?? Archive;
        return (
          <Row key={entry.status} gap="r6" align="center">
            <Icon size={12} className="text-fg-muted shrink-0" />
            <Text variant="body-3" color="muted">
              {entry.projectCount} {entry.status}{" "}
              {entry.projectCount === 1 ? "project" : "projects"}
              {" \u00B7 "}
              {entry.totalTasks} {entry.totalTasks === 1 ? "task" : "tasks"}
            </Text>
          </Row>
        );
      })}
    </Row>
  );
}

export { ArchivedProjectsSummary };

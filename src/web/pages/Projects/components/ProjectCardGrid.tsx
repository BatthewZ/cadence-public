import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  FolderKanban,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Settings,
  Star,
  Trash2,
} from "lucide-react";

import { Row, Stack } from "@/web/components/layout";
import {
  Badge,
  Card,
  IconButton,
  Text,
} from "@/web/components/ui";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { IconDisplay } from "@/web/components/ui/IconDisplay";
import type { WorkspaceProject } from "@/web/contexts/WorkspaceContext";

const statusBadgeVariant: Record<WorkspaceProject["status"], "default" | "warning" | "success"> = {
  active: "success",
  archived: "default",
  completed: "success",
};

export function ProjectCardGrid({
  projects: gridProjects,
  tab,
  onOpenProject,
  onOpenRenameDialog,
  onNavigateToSettings,
  onChangeProjectStatus,
  onDeleteProject,
  onDuplicateProject,
  isFavorite,
  toggleFavorite,
}: {
  projects: WorkspaceProject[];
  tab: "active" | "completed" | "archived";
  onOpenProject: (projectId: string) => void;
  onOpenRenameDialog: (project: WorkspaceProject) => void;
  onNavigateToSettings: (projectId: string) => void;
  onChangeProjectStatus: (
    projectId: string,
    status: "active" | "completed" | "archived",
    successMessage: string,
    failureMessage: string,
  ) => void;
  onDeleteProject: (project: WorkspaceProject) => void;
  onDuplicateProject: (project: WorkspaceProject) => void;
  isFavorite: (projectId: string) => boolean;
  toggleFavorite: (projectId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {gridProjects.map((project) => (
        <Card
          key={project.id}
          className="group relative cursor-pointer hover:shadow-lg transition-shadow duration-fast"
          onClick={() => onOpenProject(project.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenProject(project.id);
            }
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleFavorite(project.id);
            }}
            className={`absolute top-2 left-2 inline-flex items-center justify-center size-7 rounded-md transition-colors ${
              isFavorite(project.id)
                ? "text-amber-400"
                : "text-fg-muted hover:text-fg-primary opacity-0 hover:opacity-100 group-hover:opacity-60"
            }`}
            aria-label={isFavorite(project.id) ? "Remove from favorites" : "Add to favorites"}
          >
            <Star size={16} fill={isFavorite(project.id) ? "currentColor" : "none"} />
          </button>
          <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu placement="bottom-end">
              <DropdownMenu.Trigger asChild>
                <IconButton
                  aria-label="Project actions"
                  className="size-9"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal size={22} />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item
                  index={0}
                  icon={<FolderOpen size={14} />}
                  onSelect={() => onOpenProject(project.id)}
                >
                  Open project
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  index={1}
                  icon={<Pencil size={14} />}
                  onSelect={() => onOpenRenameDialog(project)}
                >
                  Rename
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  index={2}
                  icon={<Settings size={14} />}
                  onSelect={() => onNavigateToSettings(project.id)}
                >
                  Project settings
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  index={3}
                  icon={<Copy size={14} />}
                  onSelect={() => onDuplicateProject(project)}
                >
                  Duplicate project
                </DropdownMenu.Item>
                <DropdownMenu.Divider />
                {tab === "active" && (
                  <>
                    <DropdownMenu.Item
                      index={4}
                      icon={<CheckCircle2 size={14} />}
                      onSelect={() => void onChangeProjectStatus(project.id, "completed", "Project marked as completed", "Failed to complete project")}
                    >
                      Mark as completed
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      index={5}
                      icon={<Archive size={14} />}
                      onSelect={() => void onChangeProjectStatus(project.id, "archived", "Project archived", "Failed to archive project")}
                    >
                      Archive project
                    </DropdownMenu.Item>
                  </>
                )}
                {tab === "completed" && (
                  <>
                    <DropdownMenu.Item
                      index={4}
                      icon={<RotateCcw size={14} />}
                      onSelect={() => void onChangeProjectStatus(project.id, "active", "Project restored", "Failed to restore project")}
                    >
                      Reopen project
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      index={5}
                      icon={<Archive size={14} />}
                      onSelect={() => void onChangeProjectStatus(project.id, "archived", "Project archived", "Failed to archive project")}
                    >
                      Archive project
                    </DropdownMenu.Item>
                  </>
                )}
                {tab === "archived" && (
                  <DropdownMenu.Item
                    index={4}
                    icon={<ArchiveRestore size={14} />}
                    onSelect={() => void onChangeProjectStatus(project.id, "active", "Project restored", "Failed to restore project")}
                  >
                    Restore project
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item
                  index={tab === "archived" ? 5 : 6}
                  variant="danger"
                  icon={<Trash2 size={14} />}
                  onSelect={() => onDeleteProject(project)}
                >
                  Delete project
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>
          <Stack gap="r5">
            <Row gap="r4" align="center">
              <span className="inline-flex shrink-0 items-center justify-center size-10 rounded-lg bg-accent/10 text-accent">
                <IconDisplay name={project.icon} fallback={FolderKanban} size={24} />
              </span>
              <Stack gap="r6" className="min-w-0">
                <Text variant="h5" className="truncate">{project.name}</Text>
                <Text variant="body-3" color="muted">
                  {project.taskCount} {project.taskCount === 1 ? "task" : "tasks"}{" "}
                  &middot; {project.memberCount} {project.memberCount === 1 ? "member" : "members"}
                </Text>
              </Stack>
            </Row>
            {project.description && (
              <Text variant="body-2" color="secondary" className="line-clamp-2">
                {project.description}
              </Text>
            )}
            <Badge variant={statusBadgeVariant[project.status]}>{project.status}</Badge>
          </Stack>
        </Card>
      ))}
    </div>
  );
}

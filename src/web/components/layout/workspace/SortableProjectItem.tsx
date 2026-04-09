import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderKanban, GripVertical, Star } from "lucide-react";

import { AppShell } from "@/web/components/ui/AppShell";
import type { WorkspaceProject } from "@/web/contexts/WorkspaceContext";
import { getIconComponent } from "@/web/lib/icon-map";

interface SortableProjectItemProps {
  project: WorkspaceProject;
  basePath: string;
  isFavorite: boolean;
  onToggleFavorite: (projectId: string) => void;
}

export function SortableProjectItem({
  project,
  basePath,
  isFavorite,
  onToggleFavorite,
}: SortableProjectItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative [&:hover_.app-shell-sidebar-link-icon]:opacity-0 ${isDragging ? "opacity-50" : ""}`}
    >
      <AppShell.SidebarLink
        to={`${basePath}/projects/${project.id}`}
        icon={getIconComponent(project.icon) ?? FolderKanban}
      >
        {project.name}
      </AppShell.SidebarLink>
      {/* Drag handle — overlays the project icon on hover */}
      <button
        type="button"
        className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center size-5 cursor-grab active:cursor-grabbing touch-none opacity-0 group-hover:opacity-100 transition-opacity text-fg-muted"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onToggleFavorite(project.id);
        }}
        className={`absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-5 rounded hover:bg-surface-2 transition-opacity ${
          isFavorite
            ? "opacity-100 text-amber-400"
            : "opacity-0 group-hover:opacity-100 text-fg-muted"
        }`}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      >
        <Star size={12} fill={isFavorite ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

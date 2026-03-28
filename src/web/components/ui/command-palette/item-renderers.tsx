import {
  ArrowRight,
  CheckSquare,
  Clock,
  FolderKanban,
  Square,
  Star,
} from "lucide-react";

import { Badge } from "@/web/components/ui/Badge";
import type { RecentItem } from "@/web/hooks/use-recents";
import { getIconComponent } from "@/web/lib/icon-map";
import { getPriorityBadgeVariant, getPriorityLabel } from "@/web/util/task-display";

import type { ActionItem, NavItem } from "./constants";

export interface SearchResult {
  type: "project" | "task";
  id: string;
  label: string;
  description?: string | null;
  projectId?: string;
  projectName?: string;
  projectIcon?: string | null;
  icon?: string | null;
  status?: string;
  priority?: string;
  completed?: boolean;
}

export type UnifiedItem =
  | { kind: "recent"; data: RecentItem }
  | { kind: "favorite"; data: { id: string; name: string; icon?: string | null } }
  | { kind: "nav"; data: NavItem }
  | { kind: "action"; data: ActionItem }
  | { kind: "search-project"; data: SearchResult }
  | { kind: "search-task"; data: SearchResult };

export function getItemKey(item: UnifiedItem): string {
  switch (item.kind) {
    case "nav": return `nav-${item.data.path}`;
    case "action": return `action-${item.data.action}`;
    case "recent": return `recent-${item.data.type}-${item.data.id}`;
    case "favorite": return `favorite-${item.data.id}`;
    case "search-project": return `project-${item.data.id}`;
    case "search-task": return `task-${item.data.id}`;
    default: { const _exhaustive: never = item; return _exhaustive; }
  }
}

export function getItemLabel(item: UnifiedItem): string {
  switch (item.kind) {
    case "nav":
    case "action": return item.data.label;
    case "recent": return item.data.name;
    case "favorite": return item.data.name;
    case "search-project":
    case "search-task": return item.data.label;
    default: { const _exhaustive: never = item; return _exhaustive; }
  }
}

export function getItemContext(item: UnifiedItem): string | null {
  switch (item.kind) {
    case "search-task":
      return item.data.projectName ?? null;
    case "search-project": {
      const desc = item.data.description;
      if (!desc) return null;
      return desc.length > 60 ? `${desc.slice(0, 60)}...` : desc;
    }
    case "recent":
      return item.data.type === "project" ? "Project" : "Task";
    case "favorite":
      return "Favorite";
    default:
      return null;
  }
}

export function renderItemIcon(item: UnifiedItem) {
  switch (item.kind) {
    case "nav":
    case "action": {
      const Icon = item.data.icon;
      return <Icon size={16} className="shrink-0 text-fg-muted" />;
    }
    case "recent":
      return item.data.type === "project"
        ? <FolderKanban size={16} className="shrink-0 text-fg-muted" />
        : <Clock size={16} className="shrink-0 text-fg-muted" />;
    case "favorite": {
      const FavIcon = getIconComponent(item.data.icon) ?? FolderKanban;
      return <FavIcon size={16} className="shrink-0 text-amber-400" />;
    }
    case "search-project": {
      const ProjIcon = getIconComponent(item.data.icon) ?? FolderKanban;
      return <ProjIcon size={16} className="shrink-0 text-fg-muted" />;
    }
    case "search-task": {
      const TaskIcon = item.data.completed ? CheckSquare : Square;
      return <TaskIcon size={16} className={`shrink-0 ${item.data.completed ? "text-status-success" : "text-fg-muted"}`} />;
    }
  }
}

export function renderItemBadge(item: UnifiedItem) {
  if (item.kind === "search-project" && item.data.status) {
    return (
      <Badge
        variant={item.data.status === "active" ? "success" : item.data.status === "archived" ? "default" : "info"}
        className="shrink-0"
      >
        {item.data.status}
      </Badge>
    );
  }
  if (item.kind === "search-task" && item.data.priority && item.data.priority !== "none") {
    return (
      <Badge variant={getPriorityBadgeVariant(item.data.priority)} className="shrink-0">
        {getPriorityLabel(item.data.priority)}
      </Badge>
    );
  }
  if (item.kind === "favorite") {
    return <Star size={12} className="shrink-0 text-amber-400" fill="currentColor" />;
  }
  if (item.kind === "nav") {
    return <ArrowRight size={14} className="shrink-0 text-fg-muted opacity-0 group-hover:opacity-100" />;
  }
  return null;
}

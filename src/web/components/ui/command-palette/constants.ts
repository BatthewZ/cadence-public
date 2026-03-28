import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CheckSquare,
  FolderKanban,
  LayoutDashboard,
  Palette,
  Plus,
  Settings,
} from "lucide-react";

export interface NavItem {
  type: "nav";
  label: string;
  icon: LucideIcon;
  path: string;
}

export interface ActionItem {
  type: "action";
  label: string;
  icon: LucideIcon;
  action: string;
}

export const NAVIGATION_ITEMS: NavItem[] = [
  { type: "nav", label: "Go to Dashboard", icon: LayoutDashboard, path: "dashboard" },
  { type: "nav", label: "Go to My Tasks", icon: CheckSquare, path: "my-tasks" },
  { type: "nav", label: "Go to Projects", icon: FolderKanban, path: "projects" },
  { type: "nav", label: "Go to Settings", icon: Settings, path: "settings" },
  { type: "nav", label: "Go to Notifications", icon: Bell, path: "notifications" },
];

export const QUICK_ACTIONS: ActionItem[] = [
  { type: "action", label: "Create Project", icon: Plus, action: "create-project" },
  { type: "action", label: "Toggle Theme", icon: Palette, action: "toggle-theme" },
];

import {
  Layers,
  Layout,
  Palette,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";

import type { Theme } from "@/shared/types/theme";
import { THEMES as ALL_THEME_IDS } from "@/shared/types/theme";
import { THEME_LABELS, THEME_PALETTES } from "@/web/lib/theme-constants";

const FEATURES = [
  {
    icon: Layout,
    title: "Multiple Views",
    description:
      "Switch between Kanban board, list, and timeline views. Work the way that feels right to you.",
  },
  {
    icon: Palette,
    title: `${ALL_THEME_IDS.length} Beautiful Themes`,
    description:
      "From minimal to bold — pick a theme that feels like yours, or let each project set its own tone.",
  },
  {
    icon: Shield,
    title: "Own Your Data",
    description:
      "Your work lives in infrastructure you control. No black box, no lock-in, no surprises on the bill.",
  },
  {
    icon: Sparkles,
    title: "Simple by Default",
    description:
      "Sensible defaults over infinite options. Spend your time on the work, not configuring the tool.",
  },
  {
    icon: Users,
    title: "In Sync",
    description:
      "Invite others when you're ready. Assign tasks, comment, and see who's working on what.",
  },
  {
    icon: Layers,
    title: "Smart Organization",
    description:
      "Labels, priorities, due dates, subtasks, and file attachments — all in one place.",
  },
];

/**
 * Curated subset of themes featured on the Landing page.
 * These are selected for visual variety in the theme showcase strip.
 */
const FEATURED_THEME_IDS: Theme[] = [
  "default",
  "noir",
  "botanical",
  "ocean",
  "sakura",
  "cyberpunk",
  "ember",
  "luxe",
];

/**
 * Landing-page theme cards derived from the canonical THEME_LABELS and THEME_PALETTES.
 * Each entry contains the human-readable name and the key palette colors
 * (canvas, primary, accent, surface) for the color-strip preview.
 */
const THEMES = FEATURED_THEME_IDS.map((id) => ({
  name: THEME_LABELS[id],
  colors: [...THEME_PALETTES[id]],
}));

/**
 * Themes not featured in the showcase — used for the "+N more" footer text.
 */
const REMAINING_THEMES = ALL_THEME_IDS.filter(
  (id) => !FEATURED_THEME_IDS.includes(id),
).map((id) => THEME_LABELS[id]);

const MOCK_COLUMNS = [
  {
    title: "To Do",
    count: 5,
    cards: [
      {
        title: "Design system audit",
        label: { name: "Design", color: "#3b82f6" },
        priority: "medium" as const,
      },
      {
        title: "User onboarding flow",
        label: { name: "Feature", color: "#8b5cf6" },
        priority: "high" as const,
      },
      {
        title: "API rate limiting",
        label: { name: "Backend", color: "#f97316" },
        priority: "low" as const,
      },
    ],
  },
  {
    title: "In Progress",
    count: 3,
    cards: [
      {
        title: "Dashboard analytics",
        label: { name: "Feature", color: "#8b5cf6" },
        priority: "high" as const,
        avatar: "AK",
      },
      {
        title: "Payment integration",
        label: { name: "Backend", color: "#f97316" },
        priority: "medium" as const,
        avatar: "JL",
      },
    ],
  },
  {
    title: "Done",
    count: 8,
    cards: [
      {
        title: "Auth system",
        label: { name: "Backend", color: "#f97316" },
        done: true,
        avatar: "SM",
      },
      {
        title: "Team invitations",
        label: { name: "Feature", color: "#8b5cf6" },
        done: true,
        avatar: "AK",
      },
    ],
  },
];

type MockCard = {
  title: string;
  label: { name: string; color: string };
  priority?: "high" | "medium" | "low";
  avatar?: string;
  done?: boolean;
};

const RHYTHM_HEIGHTS = [35, 65, 45, 80, 55, 90, 40, 70, 50, 85, 45, 75, 60, 95, 38, 72];

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-status-error",
  medium: "bg-status-warning",
  low: "bg-status-success",
};

export { FEATURES, MOCK_COLUMNS, PRIORITY_DOT, REMAINING_THEMES, RHYTHM_HEIGHTS, THEMES };
export type { MockCard };

import { Link, useLocation } from "react-router-dom";

import { cn } from "@/web/util/style/style";

const TABS = [
  { label: "General", path: "" },
  { label: "Members", path: "/members" },
  { label: "Teams", path: "/teams" },
  { label: "Webhooks", path: "/webhooks" },
  { label: "API Tokens", path: "/api-tokens" },
  { label: "Data", path: "/data" },
];

export function SettingsNav({ basePath }: { basePath: string }) {
  const { pathname } = useLocation();

  return (
    <nav className="flex gap-1 border-b border-border-default -mx-r3 px-r3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((tab) => {
        const to = basePath + tab.path;
        const isActive = tab.path === ""
          ? pathname === basePath || pathname === basePath + "/"
          : pathname.startsWith(to);

        return (
          <Link
            key={tab.path}
            to={to}
            className={cn(
              "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0",
              isActive
                ? "border-accent text-accent"
                : "border-transparent text-fg-muted hover:text-fg-primary hover:border-border-default"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

import { useQuery } from "@tanstack/react-query";
import {
  Search,
} from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { Dialog } from "@/web/components/ui/Dialog";
import { Spinner } from "@/web/components/ui/Spinner";
import { Text } from "@/web/components/ui/Text";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useDebounce } from "@/web/hooks/use-debounce";
import { useFavorites } from "@/web/hooks/use-favorites";
import { useWorkspacePermissions } from "@/web/hooks/use-permissions";
import { useRecents } from "@/web/hooks/use-recents";
import { api } from "@/web/lib/api/client";
import { queryKeys } from "@/web/lib/query-keys";

import { NAVIGATION_ITEMS, QUICK_ACTIONS } from "./constants";
import {
  getItemContext,
  getItemKey,
  getItemLabel,
  renderItemBadge,
  renderItemIcon,
  type SearchResult,
  type UnifiedItem,
} from "./item-renderers";

interface SearchResponse {
  projects: Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    icon: string | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    priority: string;
    completed: boolean;
    projectId: string;
    projectName: string;
    projectIcon: string | null;
  }>;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onAction?: (action: string) => void;
}

interface UnifiedEntry {
  item: UnifiedItem;
  sectionStart?: string;
}

export function CommandPalette({ open, onClose, onAction }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { workspace, projects } = useWorkspace();
  const { canCreateProject } = useWorkspacePermissions();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const debouncedQuery = useDebounce(query, 200);
  const { recents, addRecent } = useRecents(workspace.id);
  const { favorites } = useFavorites(workspace.id);
  const favoriteProjects = useMemo(() =>
    projects.filter((p) => favorites.includes(p.id)),
    [projects, favorites],
  );

  const { data, isFetching, isError: isSearchError } = useQuery({
    queryKey: queryKeys.workspaces.search(workspace.id, debouncedQuery),
    queryFn: () =>
      api.get<SearchResponse>(
        `/api/workspaces/${workspace.id}/search?q=${encodeURIComponent(debouncedQuery)}&limit=20`,
      ),
    enabled: open && debouncedQuery.length >= 1,
  });

  // Flatten search results into a single ordered list
  const searchResults = useMemo<SearchResult[]>(() => {
    if (!data) return [];
    const items: SearchResult[] = [];

    for (const p of data.projects) {
      items.push({
        type: "project",
        id: p.id,
        label: p.name,
        description: p.description,
        icon: p.icon,
        status: p.status,
      });
    }

    for (const t of data.tasks) {
      items.push({
        type: "task",
        id: t.id,
        label: t.title,
        projectId: t.projectId,
        projectName: t.projectName,
        projectIcon: t.projectIcon,
        priority: t.priority,
        completed: t.completed,
      });
    }

    return items;
  }, [data]);

  // Filter nav/action items by query
  const filteredNavItems = useMemo(() => {
    if (!query.trim()) return NAVIGATION_ITEMS;
    const q = query.toLowerCase();
    return NAVIGATION_ITEMS.filter((item) => item.label.toLowerCase().includes(q));
  }, [query]);

  const filteredActionItems = useMemo(() => {
    // Removed rather than disabled — the opposite of the New Project button's
    // treatment, and for a reason the two surfaces do not share. A palette is
    // a list of things you can do right now, navigated by typing and pressing
    // Enter; a row that looks selectable but refuses on Enter breaks that
    // contract, and there is nowhere to hover for the explanation. The button
    // stays put because it occupies a place in the layout that would look
    // broken empty. Nothing is hidden by this: the Projects page and dashboard
    // still explain the policy in words.
    const available = canCreateProject
      ? QUICK_ACTIONS
      : QUICK_ACTIONS.filter((item) => item.action !== "create-project");
    if (!query.trim()) return available;
    const q = query.toLowerCase();
    return available.filter((item) => item.label.toLowerCase().includes(q));
  }, [query, canCreateProject]);

  // Build unified items list with section markers
  const allItems = useMemo<UnifiedEntry[]>(() => {
    const items: UnifiedEntry[] = [];

    if (!query.trim()) {
      // Empty query: show recents, then nav, then actions
      if (recents.length > 0) {
        recents.slice(0, 5).forEach((r, i) => {
          items.push({
            item: { kind: "recent", data: r },
            ...(i === 0 ? { sectionStart: "Recent" } : {}),
          });
        });
      }
      if (favoriteProjects.length > 0) {
        favoriteProjects.forEach((p, i) => {
          items.push({
            item: { kind: "favorite", data: { id: p.id, name: p.name, icon: p.icon } },
            ...(i === 0 ? { sectionStart: "Favorites" } : {}),
          });
        });
      }
      filteredNavItems.forEach((n, i) => {
        items.push({
          item: { kind: "nav", data: n },
          ...(i === 0 ? { sectionStart: "Navigation" } : {}),
        });
      });
      filteredActionItems.forEach((a, i) => {
        items.push({
          item: { kind: "action", data: a },
          ...(i === 0 ? { sectionStart: "Quick Actions" } : {}),
        });
      });
    } else {
      // Query: show filtered nav/actions first, then search results
      if (filteredNavItems.length > 0) {
        filteredNavItems.forEach((n, i) => {
          items.push({
            item: { kind: "nav", data: n },
            ...(i === 0 ? { sectionStart: "Navigation" } : {}),
          });
        });
      }
      if (filteredActionItems.length > 0) {
        filteredActionItems.forEach((a, i) => {
          items.push({
            item: { kind: "action", data: a },
            ...(i === 0 ? { sectionStart: "Quick Actions" } : {}),
          });
        });
      }
      const projects = searchResults.filter((r) => r.type === "project");
      const tasks = searchResults.filter((r) => r.type === "task");
      if (projects.length > 0) {
        projects.forEach((p, i) => {
          items.push({
            item: { kind: "search-project", data: p },
            ...(i === 0 ? { sectionStart: "Projects" } : {}),
          });
        });
      }
      if (tasks.length > 0) {
        tasks.forEach((t, i) => {
          items.push({
            item: { kind: "search-task", data: t },
            ...(i === 0 ? { sectionStart: "Tasks" } : {}),
          });
        });
      }
    }

    return items;
  }, [query, recents, favoriteProjects, filteredNavItems, filteredActionItems, searchResults]);

  // Focus input when mounted
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleSelect = useCallback(
    (entry: UnifiedEntry) => {
      const { item } = entry;
      const basePath = `/w/${workspace.slug}`;

      switch (item.kind) {
        case "nav":
          void navigate(`${basePath}/${item.data.path}`);
          break;
        case "action":
          onAction?.(item.data.action);
          break;
        case "recent":
          if (item.data.type === "project") {
            void navigate(`${basePath}/projects/${item.data.id}/board`);
          } else {
            void navigate(`${basePath}/projects/${item.data.projectId}/board?task=${item.data.id}`);
          }
          break;
        case "favorite":
          void navigate(`${basePath}/projects/${item.data.id}/board`);
          break;
        case "search-project":
          addRecent({ id: item.data.id, name: item.data.label, type: "project" });
          void navigate(`${basePath}/projects/${item.data.id}/board`);
          break;
        case "search-task":
          addRecent({
            id: item.data.id,
            name: item.data.label,
            type: "task",
            projectId: item.data.projectId,
          });
          void navigate(`${basePath}/projects/${item.data.projectId}/board?task=${item.data.id}`);
          break;
      }
      onClose();
    },
    [workspace.slug, navigate, onClose, onAction, addRecent],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(1, allItems.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? Math.max(0, allItems.length - 1) : i - 1));
      } else if (e.key === "Enter" && allItems[activeIndex]) {
        e.preventDefault();
        handleSelect(allItems[activeIndex]);
      }
    },
    [allItems, activeIndex, handleSelect],
  );

  return (
    <Dialog open={open} onClose={onClose} className="command-palette">
      <div className="command-palette__inner" onKeyDown={handleKeyDown}>
        {/* Search input */}
        <div className="command-palette__header">
          <Search size={16} className="text-fg-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            placeholder="Search or jump to..."
            className="command-palette__input"
            role="combobox"
            aria-expanded={allItems.length > 0}
            aria-activedescendant={
              allItems[activeIndex]
                ? `command-palette-item-${getItemKey(allItems[activeIndex].item)}`
                : undefined
            }
          />
          {isFetching && <Spinner size="sm" />}
        </div>

        {/* Results */}
        <div ref={listRef} className="command-palette__results" role="listbox">
          {isSearchError && debouncedQuery.length >= 1 && (
            <div className="command-palette__empty">
              <Text variant="body-3" color="muted">
                Search failed. Please try again.
              </Text>
            </div>
          )}

          {!isSearchError && debouncedQuery.length >= 1 && !isFetching && allItems.length === 0 && (
            <div className="command-palette__empty">
              <Text variant="body-3" color="muted">
                No results for &ldquo;{debouncedQuery}&rdquo;
              </Text>
            </div>
          )}

          {!query.trim() && allItems.length === 0 && (
            <div className="command-palette__empty">
              <Text variant="body-3" color="muted">
                Start typing to search...
              </Text>
            </div>
          )}

          {allItems.map((entry, idx) => {
            const { item, sectionStart } = entry;
            const isActive = idx === activeIndex;
            const itemKey = getItemKey(item);

            return (
              <div key={itemKey}>
                {sectionStart && (
                  <div className="command-palette__group-label">
                    <Text variant="body-3" color="muted" weight="semibold">
                      {sectionStart}
                    </Text>
                  </div>
                )}
                <button
                  id={`command-palette-item-${itemKey}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive}
                  className={`command-palette__item ${isActive ? "command-palette__item--active" : ""}`}
                  onClick={() => handleSelect(entry)}
                  onMouseEnter={() => setActiveIndex(idx)}
                >
                  {renderItemIcon(item)}
                  <div className="command-palette__item-content">
                    <span className="command-palette__item-title">
                      {getItemLabel(item)}
                    </span>
                    {(() => {
                      const ctx = getItemContext(item);
                      return ctx ? <span className="command-palette__item-context">{ctx}</span> : null;
                    })()}
                  </div>
                  {renderItemBadge(item)}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer with keyboard hints */}
        <div className="command-palette__footer">
          <span className="command-palette__hint">
            <kbd className="command-palette__kbd">&uarr;</kbd>
            <kbd className="command-palette__kbd">&darr;</kbd>
            navigate
          </span>
          <span className="command-palette__hint">
            <kbd className="command-palette__kbd">&crarr;</kbd>
            open
          </span>
          <span className="command-palette__hint">
            <kbd className="command-palette__kbd">esc</kbd>
            close
          </span>
        </div>
      </div>
    </Dialog>
  );
}

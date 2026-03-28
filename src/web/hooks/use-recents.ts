import { useCallback, useEffect, useState } from "react";

interface RecentItem {
  id: string;
  name: string;
  type: "project" | "task";
  projectId?: string;
  timestamp: number;
}

const MAX_RECENTS = 10;

function getStorageKey(workspaceId: string) {
  return `cadence:recents:${workspaceId}`;
}

function loadRecents(workspaceId: string): RecentItem[] {
  try {
    const raw = localStorage.getItem(getStorageKey(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentItem[];
    return parsed.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function useRecents(workspaceId: string) {
  const [recents, setRecents] = useState<RecentItem[]>(() => loadRecents(workspaceId));

  // Reload recents when workspaceId changes
  useEffect(() => {
    setRecents(loadRecents(workspaceId));
  }, [workspaceId]);

  const addRecent = useCallback(
    (item: Omit<RecentItem, "timestamp">) => {
      setRecents((prev) => {
        const filtered = prev.filter((r) => !(r.id === item.id && r.type === item.type));
        const updated = [{ ...item, timestamp: Date.now() }, ...filtered].slice(0, MAX_RECENTS);
        try {
          localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(updated));
        } catch { /* storage full */ }
        return updated;
      });
    },
    [workspaceId],
  );

  return { recents, addRecent };
}

export type { RecentItem };

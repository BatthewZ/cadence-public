import { useCallback, useEffect, useState } from "react";

function getStorageKey(workspaceId: string) {
  return `cadence:favorites:${workspaceId}`;
}

function loadFavorites(workspaceId: string): string[] {
  try {
    const raw = localStorage.getItem(getStorageKey(workspaceId));
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export function useFavorites(workspaceId: string) {
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites(workspaceId));

  // Reload favorites when workspaceId changes
  useEffect(() => {
    setFavorites(loadFavorites(workspaceId));
  }, [workspaceId]);

  const isFavorite = useCallback(
    (projectId: string) => favorites.includes(projectId),
    [favorites],
  );

  const toggleFavorite = useCallback(
    (projectId: string) => {
      setFavorites((prev) => {
        const updated = prev.includes(projectId)
          ? prev.filter((id) => id !== projectId)
          : [...prev, projectId];
        try {
          localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(updated));
        } catch { /* storage full */ }
        return updated;
      });
    },
    [workspaceId],
  );

  return { favorites, isFavorite, toggleFavorite };
}
